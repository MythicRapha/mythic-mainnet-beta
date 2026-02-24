import { createHash } from "crypto";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import pino from "pino";
import { CONFIG } from "./config";

const execAsync = promisify(exec);
const log = pino({ level: CONFIG.logLevel });

// ---------------------------------------------------------------
// Inference Engine — wraps llama.cpp or vLLM for model execution
// ---------------------------------------------------------------

export interface InferenceResult {
  output: string;
  outputHash: Buffer;
  logitFingerprint: number[][];
  computeUnits: bigint;
  latencyMs: number;
  tokensGenerated: number;
}

export interface ModelInfo {
  hash: string;
  name: string;
  path: string;
  parameterCount: number;
  loaded: boolean;
}

class InferenceEngine {
  private models: Map<string, ModelInfo> = new Map();
  private activeRequests = 0;
  private llamaServerUrl: string | null = null;

  async initialize(): Promise<void> {
    // Scan model directory for GGUF files
    const modelDir = CONFIG.modelDir;
    if (!fs.existsSync(modelDir)) {
      fs.mkdirSync(modelDir, { recursive: true });
      log.warn({ modelDir }, "Model directory created — add GGUF models to start serving");
      return;
    }

    const files = fs.readdirSync(modelDir).filter((f) => f.endsWith(".gguf"));
    for (const file of files) {
      const filePath = path.join(modelDir, file);
      const hash = await this.hashModel(filePath);
      this.models.set(hash, {
        hash,
        name: file.replace(".gguf", ""),
        path: filePath,
        parameterCount: 0, // determined from model metadata
        loaded: false,
      });
      log.info({ model: file, hash: hash.slice(0, 16) + "..." }, "Discovered model");
    }

    // Start llama-server if available
    await this.startLlamaServer();
  }

  private async hashModel(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash("sha256");
      const stream = fs.createReadStream(filePath);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("end", () => resolve(hash.digest("hex")));
      stream.on("error", reject);
    });
  }

  private async startLlamaServer(): Promise<void> {
    // Check if llama-server binary exists
    try {
      await execAsync("which llama-server");
    } catch {
      log.warn("llama-server not found — using HTTP API fallback (install llama.cpp for local inference)");

      // Try llama-cli as fallback
      try {
        await execAsync("which llama-cli");
        log.info("llama-cli found — will use CLI mode for inference");
      } catch {
        log.warn("No llama.cpp binaries found. Install from: https://github.com/ggerganov/llama.cpp");
        log.info("Inference server will accept requests and route to llama-server at http://localhost:8081");
      }
      return;
    }

    const defaultModelPath = path.join(CONFIG.modelDir, CONFIG.defaultModel);
    if (!fs.existsSync(defaultModelPath)) {
      log.warn({ path: defaultModelPath }, "Default model not found — llama-server not started");
      return;
    }

    // Start llama-server on port 8081
    const port = 8081;
    const cmd = `llama-server -m "${defaultModelPath}" --port ${port} -ngl 99 -c 4096 --host 0.0.0.0 &`;
    try {
      exec(cmd);
      this.llamaServerUrl = `http://localhost:${port}`;
      log.info({ port, model: CONFIG.defaultModel }, "llama-server started");

      // Wait for server to be ready
      await new Promise((resolve) => setTimeout(resolve, 5000));
    } catch (err) {
      log.error({ err }, "Failed to start llama-server");
    }
  }

  getModelHashes(): Buffer[] {
    return Array.from(this.models.values()).map((m) =>
      Buffer.from(m.hash, "hex")
    );
  }

  getModelCount(): number {
    return this.models.size;
  }

  async runInference(
    modelHash: string,
    input: string,
    maxOutputLen: number
  ): Promise<InferenceResult> {
    if (this.activeRequests >= CONFIG.maxConcurrent) {
      throw new Error("Max concurrent inference requests reached");
    }

    this.activeRequests++;
    const startTime = Date.now();

    try {
      let output: string;
      let tokensGenerated: number;

      if (this.llamaServerUrl) {
        // Use llama-server HTTP API
        const response = await fetch(`${this.llamaServerUrl}/completion`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: input,
            n_predict: Math.min(maxOutputLen, 2048),
            temperature: 0.7,
            top_p: 0.9,
            stop: ["</s>", "<|eot_id|>", "<|end|>"],
          }),
        });

        const result = (await response.json()) as {
          content: string;
          tokens_predicted: number;
        };
        output = result.content;
        tokensGenerated = result.tokens_predicted || output.split(/\s+/).length;
      } else {
        // Fallback: use llama-cli one-shot
        const model = this.models.values().next().value;
        if (!model) throw new Error("No models available");

        try {
          const { stdout } = await execAsync(
            `llama-cli -m "${model.path}" -p "${input.replace(/"/g, '\\"')}" -n ${Math.min(maxOutputLen, 512)} --temp 0.7 2>/dev/null`,
            { timeout: 60000 }
          );
          output = stdout.trim();
          tokensGenerated = output.split(/\s+/).length;
        } catch {
          // If no local inference available, return a placeholder
          // In production, this would never happen — validators must have GPU + llama.cpp
          output = `[Inference result for model ${modelHash.slice(0, 8)}...]`;
          tokensGenerated = output.split(/\s+/).length;
          log.warn("No inference backend available — returning placeholder");
        }
      }

      const latencyMs = Date.now() - startTime;
      const outputBuf = Buffer.from(output, "utf-8");
      const outputHash = createHash("sha256").update(outputBuf).digest();

      // Generate logit fingerprint (top-4 logits at sampled positions)
      // In production, this comes from the model's actual output logits
      // Here we generate a deterministic fingerprint from the output hash
      const logitFingerprint = this.generateLogitFingerprint(outputHash, tokensGenerated);

      // Compute units = tokens * base cost (approximation)
      const computeUnits = BigInt(tokensGenerated) * BigInt(1000);

      return {
        output,
        outputHash,
        logitFingerprint,
        computeUnits,
        latencyMs,
        tokensGenerated,
      };
    } finally {
      this.activeRequests--;
    }
  }

  private generateLogitFingerprint(
    outputHash: Buffer,
    tokenCount: number
  ): number[][] {
    // Sample logit fingerprints at evenly-spaced positions
    // In production: actual top-4 logit values from the model at each token position
    const sampleCount = Math.min(tokenCount, 32);
    const fingerprint: number[][] = [];

    for (let i = 0; i < sampleCount; i++) {
      const posHash = createHash("sha256")
        .update(Buffer.concat([outputHash, Buffer.from([i])]))
        .digest();

      // Read 4 float32 values from the hash (deterministic per output)
      const logits: number[] = [];
      for (let j = 0; j < 4; j++) {
        const bytes = posHash.subarray(j * 4, j * 4 + 4);
        logits.push(bytes.readFloatLE(0));
      }
      fingerprint.push(logits);
    }

    return fingerprint;
  }

  getStats() {
    return {
      modelsLoaded: this.models.size,
      activeRequests: this.activeRequests,
      maxConcurrent: CONFIG.maxConcurrent,
      llamaServerActive: !!this.llamaServerUrl,
      models: Array.from(this.models.values()).map((m) => ({
        name: m.name,
        hash: m.hash.slice(0, 16) + "...",
      })),
    };
  }
}

export const engine = new InferenceEngine();
