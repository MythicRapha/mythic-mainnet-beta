import express from "express";
import pino from "pino";
import { CONFIG } from "./config";
import { engine } from "./inference";
import { ChainWatcher } from "./watcher";

const log = pino({ level: CONFIG.logLevel });

export function createHttpServer(watcher: ChainWatcher) {
  const app = express();
  app.use(express.json());

  // Health check
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "mythic-inference-server",
      version: "1.0.0",
      uptime: process.uptime(),
    });
  });

  // Stats endpoint
  app.get("/stats", (_req, res) => {
    res.json({
      inference: engine.getStats(),
      chain: watcher.getStats(),
      config: {
        gpuModel: CONFIG.gpuModel,
        vramGb: CONFIG.vramGb,
        maxConcurrent: CONFIG.maxConcurrent,
        rpcUrl: CONFIG.l2RpcUrl,
      },
    });
  });

  // Direct inference endpoint (for local testing / gateway API)
  app.post("/v1/inference", async (req, res) => {
    try {
      const { prompt, model_hash, max_tokens } = req.body;

      if (!prompt) {
        res.status(400).json({ error: "prompt is required" });
        return;
      }

      const result = await engine.runInference(
        model_hash || "default",
        prompt,
        max_tokens || 512
      );

      res.json({
        output: result.output,
        output_hash: result.outputHash.toString("hex"),
        tokens_generated: result.tokensGenerated,
        compute_units: result.computeUnits.toString(),
        latency_ms: result.latencyMs,
      });
    } catch (err: any) {
      log.error({ err }, "Inference error");
      res.status(500).json({ error: err.message });
    }
  });

  // Chat completion endpoint (OpenAI-compatible)
  app.post("/v1/chat/completions", async (req, res) => {
    try {
      const { messages, model, max_tokens, temperature, stream } = req.body;

      if (!messages || !Array.isArray(messages)) {
        res.status(400).json({ error: "messages array is required" });
        return;
      }

      // Format messages into a single prompt
      const prompt = messages
        .map((m: { role: string; content: string }) => {
          if (m.role === "system") return `System: ${m.content}`;
          if (m.role === "user") return `User: ${m.content}`;
          if (m.role === "assistant") return `Assistant: ${m.content}`;
          return m.content;
        })
        .join("\n") + "\nAssistant:";

      const result = await engine.runInference(
        model || "default",
        prompt,
        max_tokens || 512
      );

      // OpenAI-compatible response format
      res.json({
        id: `mythic-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: model || "mythic-default",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: result.output,
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: prompt.split(/\s+/).length,
          completion_tokens: result.tokensGenerated,
          total_tokens: prompt.split(/\s+/).length + result.tokensGenerated,
        },
        mythic_metadata: {
          output_hash: result.outputHash.toString("hex"),
          compute_units: result.computeUnits.toString(),
          latency_ms: result.latencyMs,
          on_chain: true,
        },
      });
    } catch (err: any) {
      log.error({ err }, "Chat completion error");
      res.status(500).json({ error: err.message });
    }
  });

  // Models endpoint
  app.get("/v1/models", (_req, res) => {
    const stats = engine.getStats();
    res.json({
      object: "list",
      data: stats.models.map((m) => ({
        id: m.name,
        object: "model",
        created: 0,
        owned_by: "mythic-network",
        hash: m.hash,
      })),
    });
  });

  return app;
}
