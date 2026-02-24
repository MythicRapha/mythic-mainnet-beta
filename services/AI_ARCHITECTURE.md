# Mythic L2 — Decentralized AI Inference Architecture

## Overview

Mythic L2 provides decentralized AI inference as a native blockchain primitive. Validators run GPU-equipped nodes that serve AI model inference requests, with billing, verification, and fee distribution handled entirely on-chain.

## System Components

```
┌──────────────────────────────────────────────────────────────────────┐
│                         USER LAYER                                   │
│  ┌──────────┐  ┌──────────────┐  ┌──────────┐  ┌──────────────────┐│
│  │ TG Bot   │  │ Browser Ext  │  │ dApps    │  │ CLI / SDK        ││
│  │ /ai cmd  │  │ AI Chat Tab  │  │ REST API │  │ MythicAI class   ││
│  └────┬─────┘  └──────┬───────┘  └────┬─────┘  └────────┬─────────┘│
│       │               │               │                  │          │
│       └───────────────┼───────────────┼──────────────────┘          │
│                       ▼                                              │
│              ┌─────────────────┐                                     │
│              │  AI Gateway API │  ai.mythic.sh:4002                  │
│              │  (Load Balancer)│  Routes to best validator           │
│              └────────┬────────┘                                     │
└───────────────────────┼──────────────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      VALIDATOR LAYER                                 │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │ Validator Node 1 (GPU: RTX 4090, 24GB VRAM)                    │ │
│  │ ┌──────────────┐  ┌──────────────────┐  ┌───────────────────┐  │ │
│  │ │ Firedancer   │  │ Inference Server │  │ llama-server      │  │ │
│  │ │ Validator    │  │ (Node.js daemon) │  │ (llama.cpp GPU)   │  │ │
│  │ │ :8899 RPC    │  │ :8080 HTTP       │  │ :8081 inference   │  │ │
│  │ │              │←→│ Watches chain    │←→│ Runs models       │  │ │
│  │ └──────────────┘  └──────────────────┘  └───────────────────┘  │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │ Validator Node 2 (GPU: A100, 80GB VRAM)                        │ │
│  │  ... same architecture ...                                      │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │ Validator Node N                                                │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      ON-CHAIN LAYER (Mythic L2)                      │
│                                                                      │
│  ┌──────────────────────┐  ┌───────────────────────────────────────┐│
│  │ AI Precompiles        │  │ Compute Market                       ││
│  │ CT1yUSX8n5uid5Pyr... │  │ AVWSp12ji5yoiLeC9whJv5i34RGF5Lzo... ││
│  │                       │  │                                       ││
│  │ - RegisterModel       │  │ - RegisterProvider                    ││
│  │ - RegisterValidator   │  │ - RequestCompute                      ││
│  │ - RequestInference    │  │ - AcceptJob                           ││
│  │ - SubmitResult        │  │ - SubmitProof                         ││
│  │ - VerifyLogits        │  │ - VerifyAndRelease                    ││
│  │ - ClaimInferenceFee   │  │ - DisputeLease                        ││
│  └──────────────────────┘  └───────────────────────────────────────┘│
│                                                                      │
│  Fee Split: 50% Validator / 10% Foundation / 40% Burn               │
└──────────────────────────────────────────────────────────────────────┘
```

## Request Flow

### 1. User Sends Prompt
```
User → TG Bot "/ai What is Mythic L2?"
     → Browser Extension AI Tab
     → dApp via SDK: mythicAI.chat("What is Mythic L2?")
```

### 2. Gateway Routes Request
```
AI Gateway (ai.mythic.sh)
  ├── Estimates cost: ~25,600 lamports (0.0000256 SOL)
  ├── Selects best validator (lowest load, model match)
  └── Forwards to validator's inference server
```

### 3. Validator Processes
```
Inference Server
  ├── Receives prompt via HTTP
  ├── Runs model on GPU via llama-server
  ├── Generates output + logit fingerprint
  ├── Submits result on-chain (SubmitResult tx)
  └── Returns result to gateway
```

### 4. On-Chain Settlement
```
AI Precompiles Program
  ├── Stores result hash + logit fingerprint hash
  ├── 100-slot challenge window for verification
  ├── Any validator can verify by re-running inference
  │   └── Mismatch → slash submitter, reward verifier
  └── After window: validator claims fee
      ├── 50% → Validator wallet
      ├── 10% → Foundation
      └── 40% → Burn address (deflationary)
```

## Validator Setup

```bash
# 1. Clone and setup
git clone https://github.com/MythicL2/mythic-mainnet-beta
cd services/inference-server
bash setup.sh

# 2. Configure
cp .env.example .env
# Edit: L2_RPC_URL, GPU_MODEL, VRAM_GB, STAKE_AMOUNT

# 3. Add models (GGUF format)
# Download from HuggingFace
wget -O models/llama-3.1-8b.gguf "https://huggingface.co/..."

# 4. Fund validator keypair on Mythic L2
solana transfer <validator-pubkey> 10 --url https://rpc.mythic.sh

# 5. Start
npm start
# Server will:
#   - Auto-register as AI validator on-chain
#   - Start watching for inference requests
#   - Announce to gateway API
```

## Pricing

| Metric | Cost |
|--------|------|
| Per 1K input tokens | 25,000 lamports (0.000025 SOL) |
| Per 1K output tokens | 50,000 lamports (0.00005 SOL) |
| Typical chat response | ~25,000-50,000 lamports |
| Model registration fee | Set by admin (burned) |
| Validator min stake | 1 SOL |

## Verification (Logit Fingerprinting)

To prevent validators from returning fake results:

1. **Submitter** runs inference and stores top-4 logit values at sampled token positions as a SHA-256 fingerprint hash
2. **Verifier** (any other registered validator) can re-run the same inference within 100 slots
3. **Comparison**: If the verifier's logits differ beyond tolerance (1%), the submitter is slashed (50% of stake) and the verifier receives the slashed amount
4. **Economic incentive**: Honest inference is always more profitable than cheating

## API Endpoints

### AI Gateway (ai.mythic.sh)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/v1/network` | GET | Network stats (validators, GPU, capacity) |
| `/v1/models` | GET | Available models across network |
| `/v1/inference` | POST | Submit inference request |
| `/v1/chat/completions` | POST | OpenAI-compatible chat API |
| `/v1/estimate` | POST | Cost estimation |
| `/v1/jobs/:id` | GET | Job status |
| `/ws` | WS | Real-time network updates |

### Inference Server (per-validator)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Server health |
| `/stats` | GET | GPU stats, model info |
| `/v1/inference` | POST | Direct inference |
| `/v1/chat/completions` | POST | OpenAI-compatible |
| `/v1/models` | GET | Local models |

## Integration Points

### Telegram Bot
- `/ai <prompt>` command
- Shows cost estimate before execution
- Displays validator that served the request
- Links to on-chain transaction

### Browser Extension Wallet
- AI Chat tab in wallet UI
- Pre-approved spending limits
- Transaction history with AI inference costs
- Model selection dropdown

### SDK (TypeScript)
```typescript
import { MythicAI } from "@mythic/ai-sdk";

const ai = new MythicAI({ gatewayUrl: "https://ai.mythic.sh" });

// Simple chat
const result = await ai.chat("Explain Mythic L2");
console.log(result.output);

// OpenAI-compatible
const completion = await ai.chatCompletions([
  { role: "user", content: "What is DeFi?" }
]);

// Cost estimate
const cost = await ai.estimate("My prompt", 512);
console.log(`Cost: ${cost.estimatedCostSol} SOL`);

// Network stats
const stats = await ai.network();
console.log(`${stats.activeValidators} validators online`);
```
