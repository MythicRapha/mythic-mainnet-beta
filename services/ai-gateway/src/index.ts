import express from "express";
import cors from "cors";
import { WebSocketServer, WebSocket } from "ws";
import { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { createHash } from "crypto";
import { v4 as uuidv4 } from "uuid";
import pino from "pino";
import dotenv from "dotenv";
import http from "http";

dotenv.config();

const log = pino({ level: process.env.LOG_LEVEL || "info" });

const PORT = parseInt(process.env.PORT || "4002", 10);
const L2_RPC_URL = process.env.L2_RPC_URL || "http://localhost:8899";
const AI_PROGRAM_ID = new PublicKey(process.env.AI_PROGRAM_ID || "CT1yUSX8n5uid5PyrPYnoG5H6Pp2GoqYGEKmMehq3uWJ");
const CORS_ORIGINS = (process.env.CORS_ORIGINS || "*").split(",");

// ---------------------------------------------------------------
// State
// ---------------------------------------------------------------

interface ValidatorNode {
  pubkey: string;
  gpuModel: string;
  vramGb: number;
  maxConcurrent: number;
  models: { name: string; hash: string }[];
  endpoint: string;
  lastSeen: number;
  activeRequests: number;
  totalCompleted: number;
}

interface InferenceJob {
  id: string;
  prompt: string;
  model: string;
  maxTokens: number;
  status: "pending" | "processing" | "completed" | "failed";
  assignedValidator: string | null;
  result: any;
  createdAt: number;
  completedAt: number | null;
  onChainTx: string | null;
  costLamports: bigint;
}

const validators: Map<string, ValidatorNode> = new Map();
const jobs: Map<string, InferenceJob> = new Map();
const connection = new Connection(L2_RPC_URL, "confirmed");

// ---------------------------------------------------------------
// Express app
// ---------------------------------------------------------------

const app = express();
app.use(cors({ origin: CORS_ORIGINS }));
app.use(express.json({ limit: "1mb" }));

// Rate limiting (simple in-memory)
const rateLimits: Map<string, { count: number; resetAt: number }> = new Map();
const RATE_LIMIT = parseInt(process.env.RATE_LIMIT || "60", 10);

app.use((req, res, next) => {
  const ip = req.ip || "unknown";
  const now = Date.now();
  const limit = rateLimits.get(ip);

  if (!limit || limit.resetAt < now) {
    rateLimits.set(ip, { count: 1, resetAt: now + 60000 });
    next();
    return;
  }

  if (limit.count >= RATE_LIMIT) {
    res.status(429).json({ error: "Rate limit exceeded" });
    return;
  }

  limit.count++;
  next();
});

// ---------------------------------------------------------------
// Health
// ---------------------------------------------------------------

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "mythic-ai-gateway",
    version: "1.0.0",
    validators: validators.size,
    activeJobs: Array.from(jobs.values()).filter((j) => j.status === "processing").length,
    uptime: process.uptime(),
  });
});

// ---------------------------------------------------------------
// Network stats
// ---------------------------------------------------------------

app.get("/v1/network", (_req, res) => {
  const now = Date.now();
  const activeValidators = Array.from(validators.values()).filter(
    (v) => now - v.lastSeen < 60000
  );

  const totalGpuVram = activeValidators.reduce((sum, v) => sum + v.vramGb, 0);
  const totalCapacity = activeValidators.reduce((sum, v) => sum + v.maxConcurrent, 0);
  const totalCompleted = activeValidators.reduce((sum, v) => sum + v.totalCompleted, 0);

  res.json({
    active_validators: activeValidators.length,
    total_gpu_vram_gb: totalGpuVram,
    total_inference_capacity: totalCapacity,
    total_inferences_completed: totalCompleted,
    models_available: [
      ...new Set(activeValidators.flatMap((v) => v.models.map((m) => m.name))),
    ],
    validators: activeValidators.map((v) => ({
      pubkey: v.pubkey,
      gpu: v.gpuModel,
      vram_gb: v.vramGb,
      models: v.models.map((m) => m.name),
      active_requests: v.activeRequests,
      total_completed: v.totalCompleted,
    })),
  });
});

// ---------------------------------------------------------------
// Validator announcement (called by inference servers)
// ---------------------------------------------------------------

app.post("/v1/validators/announce", (req, res) => {
  const { validator, gpu_model, vram_gb, max_concurrent, models, endpoint } = req.body;

  if (!validator || !gpu_model) {
    res.status(400).json({ error: "validator and gpu_model required" });
    return;
  }

  validators.set(validator, {
    pubkey: validator,
    gpuModel: gpu_model,
    vramGb: vram_gb || 0,
    maxConcurrent: max_concurrent || 1,
    models: models || [],
    endpoint: endpoint || "",
    lastSeen: Date.now(),
    activeRequests: 0,
    totalCompleted: validators.get(validator)?.totalCompleted || 0,
  });

  log.info({ validator, gpu: gpu_model, vram: vram_gb }, "Validator announced");
  res.json({ status: "ok" });
});

// ---------------------------------------------------------------
// Inference request (user-facing)
// ---------------------------------------------------------------

app.post("/v1/inference", async (req, res) => {
  try {
    const { prompt, model, max_tokens, wallet } = req.body;

    if (!prompt) {
      res.status(400).json({ error: "prompt is required" });
      return;
    }

    const jobId = uuidv4();
    const job: InferenceJob = {
      id: jobId,
      prompt,
      model: model || "default",
      maxTokens: max_tokens || 512,
      status: "pending",
      assignedValidator: null,
      result: null,
      createdAt: Date.now(),
      completedAt: null,
      onChainTx: null,
      costLamports: BigInt(0),
    };

    jobs.set(jobId, job);

    // Route to best available validator
    const validator = selectValidator(model);
    if (!validator) {
      // No validators online — return estimate for on-chain submission
      res.json({
        job_id: jobId,
        status: "pending",
        message: "No validators currently online. Submit on-chain for async processing.",
        estimated_cost_lamports: estimateCost(prompt, max_tokens || 512),
        on_chain_instruction: buildInferenceInstruction(prompt, model),
      });
      return;
    }

    // Forward to validator's inference server
    job.status = "processing";
    job.assignedValidator = validator.pubkey;
    validator.activeRequests++;

    try {
      const result = await fetch(`${validator.endpoint}/v1/inference`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          model_hash: model,
          max_tokens: max_tokens || 512,
        }),
        signal: AbortSignal.timeout(30000),
      });

      const data = await result.json();

      job.status = "completed";
      job.result = data;
      job.completedAt = Date.now();
      validator.activeRequests--;
      validator.totalCompleted++;

      res.json({
        job_id: jobId,
        status: "completed",
        output: data.output,
        output_hash: data.output_hash,
        tokens_generated: data.tokens_generated,
        compute_units: data.compute_units,
        latency_ms: data.latency_ms,
        validator: validator.pubkey,
        on_chain: true,
      });
    } catch (err) {
      validator.activeRequests--;
      job.status = "failed";
      log.error({ err, validator: validator.pubkey }, "Validator inference failed");
      res.status(500).json({ error: "Inference failed", job_id: jobId });
    }
  } catch (err: any) {
    log.error({ err }, "Inference request error");
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------
// OpenAI-compatible chat completions
// ---------------------------------------------------------------

app.post("/v1/chat/completions", async (req, res) => {
  try {
    const { messages, model, max_tokens } = req.body;

    if (!messages) {
      res.status(400).json({ error: "messages required" });
      return;
    }

    const validator = selectValidator(model);
    if (!validator) {
      res.status(503).json({ error: "No validators available" });
      return;
    }

    validator.activeRequests++;

    try {
      const result = await fetch(`${validator.endpoint}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, model, max_tokens }),
        signal: AbortSignal.timeout(30000),
      });

      const data = await result.json();
      validator.activeRequests--;
      validator.totalCompleted++;

      res.json(data);
    } catch (err) {
      validator.activeRequests--;
      log.error({ err }, "Chat completion failed");
      res.status(500).json({ error: "Inference failed" });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------
// Job status
// ---------------------------------------------------------------

app.get("/v1/jobs/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  res.json({
    id: job.id,
    status: job.status,
    model: job.model,
    assigned_validator: job.assignedValidator,
    result: job.result,
    created_at: job.createdAt,
    completed_at: job.completedAt,
    on_chain_tx: job.onChainTx,
  });
});

// ---------------------------------------------------------------
// Available models
// ---------------------------------------------------------------

app.get("/v1/models", (_req, res) => {
  const allModels = new Map<string, { name: string; hash: string; validators: number }>();

  for (const v of validators.values()) {
    for (const m of v.models) {
      const existing = allModels.get(m.name);
      if (existing) {
        existing.validators++;
      } else {
        allModels.set(m.name, { name: m.name, hash: m.hash, validators: 1 });
      }
    }
  }

  res.json({
    object: "list",
    data: Array.from(allModels.values()).map((m) => ({
      id: m.name,
      object: "model",
      owned_by: "mythic-network",
      hash: m.hash,
      active_validators: m.validators,
    })),
  });
});

// ---------------------------------------------------------------
// Pricing estimate
// ---------------------------------------------------------------

app.post("/v1/estimate", (req, res) => {
  const { prompt, max_tokens } = req.body;
  const cost = estimateCost(prompt || "", max_tokens || 512);

  res.json({
    estimated_cost_lamports: cost.toString(),
    estimated_cost_sol: (Number(cost) / 1e9).toFixed(6),
    prompt_tokens: (prompt || "").split(/\s+/).length,
    max_completion_tokens: max_tokens || 512,
    price_per_1k_tokens_lamports: "50000",
  });
});

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

function selectValidator(model?: string): ValidatorNode | null {
  const now = Date.now();
  let bestValidator: ValidatorNode | null = null;
  let lowestLoad = Infinity;

  for (const v of validators.values()) {
    // Skip stale validators (not seen in 60s)
    if (now - v.lastSeen > 60000) continue;

    // Skip fully loaded
    if (v.activeRequests >= v.maxConcurrent) continue;

    // Model matching (if specified)
    if (model && model !== "default") {
      const hasModel = v.models.some((m) => m.name === model || m.hash.startsWith(model));
      if (!hasModel) continue;
    }

    const load = v.activeRequests / v.maxConcurrent;
    if (load < lowestLoad) {
      lowestLoad = load;
      bestValidator = v;
    }
  }

  return bestValidator;
}

function estimateCost(prompt: string, maxTokens: number): bigint {
  const promptTokens = BigInt(prompt.split(/\s+/).length);
  const completionTokens = BigInt(maxTokens);
  // Base price: 50,000 lamports per 1000 tokens (0.00005 SOL / 1K tokens)
  const totalTokens = promptTokens + completionTokens;
  return (totalTokens * BigInt(50000)) / BigInt(1000);
}

function buildInferenceInstruction(prompt: string, model?: string) {
  const inputData = Buffer.from(prompt, "utf-8");
  const inputHash = createHash("sha256").update(inputData).digest("hex");
  const modelHash = model
    ? createHash("sha256").update(model).digest("hex")
    : "0".repeat(64);

  return {
    program_id: AI_PROGRAM_ID.toBase58(),
    instruction: "RequestInference",
    args: {
      model_hash: modelHash,
      input_data_hex: inputData.toString("hex"),
      max_output_len: 512,
      max_fee: estimateCost(prompt, 512).toString(),
    },
    accounts: [
      { name: "requester", pubkey: "<your_wallet>", signer: true, writable: true },
      { name: "request_pda", pubkey: "<derived>", signer: false, writable: true },
      { name: "ai_config", pubkey: "<derived>", signer: false, writable: true },
      { name: "escrow_vault", pubkey: "<derived>", signer: false, writable: true },
      { name: "system_program", pubkey: "11111111111111111111111111111111", signer: false, writable: false },
    ],
  };
}

// ---------------------------------------------------------------
// WebSocket for real-time updates
// ---------------------------------------------------------------

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws) => {
  log.info("WebSocket client connected");

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === "subscribe" && msg.channel === "network") {
        // Send network stats every 5s
        const interval = setInterval(() => {
          if (ws.readyState !== WebSocket.OPEN) {
            clearInterval(interval);
            return;
          }

          const activeValidators = Array.from(validators.values()).filter(
            (v) => Date.now() - v.lastSeen < 60000
          );

          ws.send(
            JSON.stringify({
              type: "network_update",
              data: {
                active_validators: activeValidators.length,
                total_gpu_vram_gb: activeValidators.reduce((s, v) => s + v.vramGb, 0),
                active_jobs: Array.from(jobs.values()).filter((j) => j.status === "processing").length,
              },
            })
          );
        }, 5000);
      }
    } catch {
      // ignore
    }
  });
});

// ---------------------------------------------------------------
// Cleanup stale data
// ---------------------------------------------------------------

setInterval(() => {
  const now = Date.now();
  // Remove validators not seen in 5 minutes
  for (const [key, v] of validators) {
    if (now - v.lastSeen > 300000) {
      validators.delete(key);
      log.info({ validator: key }, "Removed stale validator");
    }
  }
  // Remove old completed jobs (keep last hour)
  for (const [key, j] of jobs) {
    if (j.completedAt && now - j.completedAt > 3600000) {
      jobs.delete(key);
    }
  }
}, 60000);

// ---------------------------------------------------------------
// Start
// ---------------------------------------------------------------

server.listen(PORT, () => {
  log.info({ port: PORT }, "Mythic AI Gateway started");
  log.info("Endpoints:");
  log.info(`  GET  /health              — Health check`);
  log.info(`  GET  /v1/network          — Network statistics`);
  log.info(`  GET  /v1/models           — Available models`);
  log.info(`  POST /v1/inference        — Submit inference request`);
  log.info(`  POST /v1/chat/completions — OpenAI-compatible chat`);
  log.info(`  POST /v1/estimate         — Cost estimation`);
  log.info(`  GET  /v1/jobs/:id         — Job status`);
  log.info(`  WS   /ws                  — Real-time updates`);
});
