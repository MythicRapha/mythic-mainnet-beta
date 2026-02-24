import { Connection } from "@solana/web3.js";
import pino from "pino";
import { CONFIG } from "./config";
import { loadKeypair, registerValidator, deriveValidatorPDA } from "./chain";
import { engine } from "./inference";
import { ChainWatcher } from "./watcher";
import { createHttpServer } from "./server";

const log = pino({ level: CONFIG.logLevel });

async function main() {
  log.info("========================================");
  log.info("  Mythic AI Inference Server v1.0.0");
  log.info("========================================");
  log.info({ rpc: CONFIG.l2RpcUrl, gpu: CONFIG.gpuModel, vram: CONFIG.vramGb }, "Configuration");

  // 1. Load validator keypair
  const keypair = loadKeypair();
  log.info({ pubkey: keypair.publicKey.toBase58() }, "Loaded validator keypair");

  // 2. Connect to L2 RPC
  const connection = new Connection(CONFIG.l2RpcUrl, "confirmed");
  const slot = await connection.getSlot();
  log.info({ slot }, "Connected to L2 RPC");

  // 3. Initialize inference engine (discover models)
  await engine.initialize();
  const stats = engine.getStats();
  log.info(
    { models: stats.modelsLoaded, llamaServer: stats.llamaServerActive },
    "Inference engine initialized"
  );

  // 4. Check if already registered on-chain
  const [validatorPDA] = deriveValidatorPDA(keypair.publicKey);
  const validatorAccount = await connection.getAccountInfo(validatorPDA);

  if (!validatorAccount) {
    log.info("Validator not registered on-chain — registering...");

    // For self-registration, the validator stakes SOL and declares GPU specs
    // The stake vault is a system account that holds the stake
    // In production, this would be a PDA-controlled vault
    const stakeVault = validatorPDA; // Simplified for initial deployment

    try {
      const modelHashes = engine.getModelHashes();
      await registerValidator(connection, keypair, stakeVault, modelHashes);
      log.info("On-chain registration complete");
    } catch (err) {
      log.warn({ err }, "Registration failed — may already be registered or insufficient balance. Continuing...");
    }
  } else {
    log.info({ pda: validatorPDA.toBase58() }, "Validator already registered on-chain");
  }

  // 5. Start chain watcher (polls for inference requests)
  const watcher = new ChainWatcher(connection, keypair);
  await watcher.start();

  // 6. Start HTTP server
  const app = createHttpServer(watcher);
  app.listen(CONFIG.httpPort, () => {
    log.info({ port: CONFIG.httpPort }, "HTTP server listening");
    log.info("Endpoints:");
    log.info(`  GET  /health              — Health check`);
    log.info(`  GET  /stats               — Server statistics`);
    log.info(`  GET  /v1/models           — List available models`);
    log.info(`  POST /v1/inference        — Direct inference`);
    log.info(`  POST /v1/chat/completions — OpenAI-compatible chat`);
  });

  // 7. Announce to gateway
  try {
    const announcePayload = {
      validator: keypair.publicKey.toBase58(),
      gpu_model: CONFIG.gpuModel,
      vram_gb: CONFIG.vramGb,
      max_concurrent: CONFIG.maxConcurrent,
      models: engine.getStats().models,
      endpoint: `http://localhost:${CONFIG.httpPort}`,
    };

    const resp = await fetch(`${CONFIG.gatewayUrl}/v1/validators/announce`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(announcePayload),
    }).catch(() => null);

    if (resp?.ok) {
      log.info("Announced to gateway API");
    } else {
      log.warn("Gateway announcement failed — gateway may not be running yet");
    }
  } catch {
    log.warn("Could not announce to gateway");
  }

  log.info("Mythic AI Inference Server is running");
  log.info("Watching for on-chain inference requests...");

  // Graceful shutdown
  process.on("SIGINT", () => {
    log.info("Shutting down...");
    watcher.stop();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    log.info("Shutting down...");
    watcher.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  log.fatal({ err }, "Fatal error");
  process.exit(1);
});
