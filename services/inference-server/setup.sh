#!/bin/bash
# =============================================================================
# Mythic AI Inference Server — Validator Setup Script
# =============================================================================
# Run this on your validator node to set up the AI inference server.
# Prerequisites: Node.js 20+, GPU with CUDA drivers, at least 24GB VRAM
# =============================================================================

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}"
echo "  ╔══════════════════════════════════════════╗"
echo "  ║   Mythic AI Inference Server Setup       ║"
echo "  ║   Decentralized AI for Mythic L2         ║"
echo "  ╚══════════════════════════════════════════╝"
echo -e "${NC}"

# Check prerequisites
echo -e "${YELLOW}Checking prerequisites...${NC}"

if ! command -v node &> /dev/null; then
    echo -e "${RED}Node.js not found. Install Node.js 20+ first.${NC}"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo -e "${RED}Node.js 20+ required (found v$NODE_VERSION)${NC}"
    exit 1
fi
echo "  Node.js: $(node -v)"

if ! command -v npm &> /dev/null; then
    echo -e "${RED}npm not found${NC}"
    exit 1
fi
echo "  npm: $(npm -v)"

# Check for GPU
if command -v nvidia-smi &> /dev/null; then
    GPU_INFO=$(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null || echo "Unknown GPU")
    echo -e "  GPU: ${GREEN}${GPU_INFO}${NC}"
else
    echo -e "  GPU: ${YELLOW}nvidia-smi not found — CPU-only mode${NC}"
fi

# Check for llama.cpp
if command -v llama-server &> /dev/null; then
    echo -e "  llama-server: ${GREEN}found${NC}"
elif command -v llama-cli &> /dev/null; then
    echo -e "  llama-cli: ${GREEN}found${NC}"
else
    echo -e "  llama.cpp: ${YELLOW}not found — will install${NC}"
    echo ""
    echo -e "${YELLOW}Installing llama.cpp...${NC}"

    if [ -d "/tmp/llama.cpp" ]; then
        rm -rf /tmp/llama.cpp
    fi

    git clone https://github.com/ggerganov/llama.cpp /tmp/llama.cpp
    cd /tmp/llama.cpp

    if command -v nvidia-smi &> /dev/null; then
        cmake -B build -DGGML_CUDA=ON
    else
        cmake -B build
    fi

    cmake --build build --config Release -j$(nproc)
    sudo cp build/bin/llama-server /usr/local/bin/
    sudo cp build/bin/llama-cli /usr/local/bin/
    echo -e "  llama.cpp: ${GREEN}installed${NC}"
    cd -
fi

echo ""

# Install dependencies
echo -e "${YELLOW}Installing Node.js dependencies...${NC}"
npm install
echo -e "${GREEN}Dependencies installed${NC}"

# Generate keypair if needed
echo ""
if [ ! -f "validator-keypair.json" ]; then
    echo -e "${YELLOW}Generating validator keypair...${NC}"
    if command -v solana-keygen &> /dev/null; then
        solana-keygen new --no-bip39-passphrase -o validator-keypair.json
    else
        echo -e "${YELLOW}solana-keygen not found — generating with Node.js...${NC}"
        node -e "
const { Keypair } = require('@solana/web3.js');
const fs = require('fs');
const kp = Keypair.generate();
fs.writeFileSync('validator-keypair.json', JSON.stringify(Array.from(kp.secretKey)));
console.log('Validator pubkey: ' + kp.publicKey.toBase58());
"
    fi
    echo -e "${GREEN}Keypair generated: validator-keypair.json${NC}"
    echo -e "${YELLOW}IMPORTANT: Fund this address with SOL on Mythic L2 for staking${NC}"
else
    echo -e "  Keypair: ${GREEN}validator-keypair.json exists${NC}"
fi

# Create models directory
mkdir -p models

# Download default model if not present
echo ""
DEFAULT_MODEL="llama-3.1-8b-instruct.Q4_K_M.gguf"
if [ ! -f "models/$DEFAULT_MODEL" ]; then
    echo -e "${YELLOW}Default model not found in models/ directory.${NC}"
    echo ""
    echo "Download a GGUF model and place it in the models/ directory."
    echo "Recommended models:"
    echo "  - Llama 3.1 8B Instruct (Q4_K_M): ~4.9 GB, good quality/speed balance"
    echo "  - Llama 3.1 70B Instruct (Q4_K_M): ~40 GB, highest quality"
    echo "  - Mistral 7B Instruct (Q4_K_M): ~4.1 GB, fast"
    echo ""
    echo "Download from: https://huggingface.co/models?search=gguf"
    echo ""
    read -p "Download Llama 3.1 8B now? (y/n) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}Downloading Llama 3.1 8B Instruct (Q4_K_M)...${NC}"
        if command -v wget &> /dev/null; then
            wget -O "models/$DEFAULT_MODEL" \
                "https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf"
        elif command -v curl &> /dev/null; then
            curl -L -o "models/$DEFAULT_MODEL" \
                "https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf"
        fi
        echo -e "${GREEN}Model downloaded${NC}"
    fi
else
    echo -e "  Model: ${GREEN}$DEFAULT_MODEL found${NC}"
fi

# Create .env from example
if [ ! -f ".env" ]; then
    cp .env.example .env
    echo -e "${YELLOW}Created .env from .env.example — edit with your configuration${NC}"
fi

# Build TypeScript
echo ""
echo -e "${YELLOW}Building TypeScript...${NC}"
npm run build 2>/dev/null || echo -e "${YELLOW}Build will complete after first run${NC}"

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   Setup Complete!                         ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
echo ""
echo "Next steps:"
echo "  1. Edit .env with your L2 RPC URL and GPU configuration"
echo "  2. Place GGUF model(s) in the models/ directory"
echo "  3. Fund your validator keypair with SOL on Mythic L2"
echo "  4. Start the server: npm start"
echo ""
echo "The server will:"
echo "  - Register as an AI validator on Mythic L2"
echo "  - Watch for inference requests on-chain"
echo "  - Run AI models on your GPU"
echo "  - Submit results and claim fees automatically"
echo ""
echo "Fee structure: 50% validator / 10% foundation / 40% burn"
echo ""
echo -e "Validator pubkey: ${GREEN}$(node -e "
const fs = require('fs');
try {
  const { Keypair } = require('@solana/web3.js');
  const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('validator-keypair.json'))));
  console.log(kp.publicKey.toBase58());
} catch { console.log('(run npm install first)'); }
" 2>/dev/null || echo "(keypair not loaded)")${NC}"
echo ""
echo -e "Documentation: ${GREEN}https://mythic.sh/docs/validators/ai-inference${NC}"
echo -e "Support: ${GREEN}https://x.com/Mythic_L2${NC}"
