import { PublicKey } from "@solana/web3.js";
import dotenv from "dotenv";
import path from "path";

dotenv.config();

export const CONFIG = {
  // RPC
  l2RpcUrl: process.env.L2_RPC_URL || "http://localhost:8899",
  l2WsUrl: process.env.L2_WS_URL || "ws://localhost:8900",

  // Keypair
  validatorKeypairPath:
    process.env.VALIDATOR_KEYPAIR_PATH || "./validator-keypair.json",

  // Stake
  stakeAmount: BigInt(process.env.STAKE_AMOUNT || "1000000000"),

  // Program
  aiProgramId: new PublicKey(
    process.env.AI_PROGRAM_ID || "CT1yUSX8n5uid5PyrPYnoG5H6Pp2GoqYGEKmMehq3uWJ"
  ),

  // GPU
  gpuModel: process.env.GPU_MODEL || "NVIDIA RTX 4090",
  vramGb: parseInt(process.env.VRAM_GB || "24", 10),

  // Models
  modelDir: process.env.MODEL_DIR || "./models",
  defaultModel: process.env.DEFAULT_MODEL || "llama-3.1-8b-instruct.Q4_K_M.gguf",

  // Server
  httpPort: parseInt(process.env.HTTP_PORT || "8080", 10),
  maxConcurrent: parseInt(process.env.MAX_CONCURRENT || "4", 10),

  // Supported models
  supportedModels: (process.env.SUPPORTED_MODELS || "")
    .split(",")
    .filter(Boolean),

  // Logging
  logLevel: process.env.LOG_LEVEL || "info",

  // Gateway
  gatewayUrl: process.env.GATEWAY_URL || "https://ai.mythic.sh",
} as const;

// PDA seeds matching the on-chain program
export const SEEDS = {
  aiConfig: Buffer.from("ai_config"),
  model: Buffer.from("model"),
  aiValidator: Buffer.from("ai_validator"),
  inference: Buffer.from("inference"),
  result: Buffer.from("result"),
  verification: Buffer.from("verification"),
} as const;
