#!/bin/bash
# Set up a Mythic L2 validator node
# Usage: ./scripts/setup-validator.sh [--ai-enabled]
set -euo pipefail

# ── Parse Arguments ──────────────────────────────────────────────────────────

AI_ENABLED=false
for arg in "$@"; do
    case "$arg" in
        --ai-enabled) AI_ENABLED=true ;;
        --help|-h)
            echo "Usage: ./scripts/setup-validator.sh [--ai-enabled]"
            echo ""
            echo "Options:"
            echo "  --ai-enabled    Install GPU drivers, CUDA, and AI runtime"
            echo "  --help, -h      Show this help message"
            exit 0
            ;;
        *)
            echo "Unknown argument: $arg"
            exit 1
            ;;
    esac
done

echo "=== Mythic L2 Validator Setup ==="
echo "AI Enabled: $AI_ENABLED"
echo ""

# ── Step 1: Install system dependencies ─────────────────────────────────────

echo "[1/10] Installing system dependencies..."
sudo apt-get update -qq
sudo apt-get install -y -qq \
    build-essential \
    pkg-config \
    libssl-dev \
    libudev-dev \
    clang \
    cmake \
    protobuf-compiler \
    git \
    curl \
    wget \
    jq \
    htop \
    net-tools
echo "  Done."

# ── Step 2: Install Rust ────────────────────────────────────────────────────

echo "[2/10] Installing Rust..."
if ! command -v rustc &>/dev/null; then
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
fi
rustup update stable
rustup default stable
echo "  Rust $(rustc --version)"
echo "  Done."

# ── Step 3: Install Solana CLI ───────────────────────────────────────────────

echo "[3/10] Installing Solana CLI..."
if ! command -v solana &>/dev/null; then
    sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
    export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
    # Add to shell profile
    if ! grep -q "solana/install" "$HOME/.profile" 2>/dev/null; then
        echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> "$HOME/.profile"
    fi
fi
echo "  Solana $(solana --version)"
echo "  Done."

# ── Step 4: Clone Mythic L2 repo ────────────────────────────────────────────

echo "[4/10] Setting up Mythic L2 source..."
MYTHIC_DIR="$HOME/mythic-l2"
MYTHIC_REPO="${MYTHIC_REPO_URL:-https://github.com/mythic-network/mythic-l2.git}"

if [ -d "$MYTHIC_DIR" ]; then
    echo "  Existing repo found, pulling latest..."
    cd "$MYTHIC_DIR"
    git pull --ff-only || echo "  Warning: git pull failed, using existing code"
else
    echo "  Cloning from $MYTHIC_REPO..."
    git clone "$MYTHIC_REPO" "$MYTHIC_DIR"
    cd "$MYTHIC_DIR"
fi
echo "  Done."

# ── Step 5: Build Mythic programs ────────────────────────────────────────────

echo "[5/10] Building Mythic L2 programs..."
cd "$MYTHIC_DIR"
source "$HOME/.cargo/env"

cargo build --release -p mythic-genesis -p mythic-relayer -p mythic-sdk 2>&1 | tail -5
echo "  Native binaries built."

for prog in bridge bridge-l2 compute-market ai-precompiles settlement myth-token; do
    echo "  Building BPF: $prog..."
    cd "$MYTHIC_DIR/programs/$prog"
    cargo build-sbf 2>&1 | tail -1
done
cd "$MYTHIC_DIR"
echo "  Done."

# ── Step 6: Build Firedancer sequencer ───────────────────────────────────────

echo "[6/10] Building Firedancer sequencer..."
FIREDANCER_DIR="$MYTHIC_DIR/firedancer"

if [ -d "$FIREDANCER_DIR" ] && [ -f "$FIREDANCER_DIR/Makefile" ]; then
    cd "$FIREDANCER_DIR"
    make -j"$(nproc)" fdctl 2>&1 | tail -5
    echo "  Firedancer built."
else
    echo "  Firedancer source not found at $FIREDANCER_DIR, skipping."
    echo "  The validator will use solana-test-validator instead."
fi
cd "$MYTHIC_DIR"
echo "  Done."

# ── Step 7: Generate validator identity ──────────────────────────────────────

echo "[7/10] Generating validator identity keypair..."
VALIDATOR_KEYPAIR="$MYTHIC_DIR/validator-keypair.json"
VOTE_KEYPAIR="$MYTHIC_DIR/vote-keypair.json"
STAKE_KEYPAIR="$MYTHIC_DIR/stake-keypair.json"

if [ ! -f "$VALIDATOR_KEYPAIR" ]; then
    solana-keygen new --no-bip39-passphrase -o "$VALIDATOR_KEYPAIR"
    echo "  Created validator keypair"
else
    echo "  Existing validator keypair found"
fi
VALIDATOR_PUBKEY=$(solana-keygen pubkey "$VALIDATOR_KEYPAIR")
echo "  Validator: $VALIDATOR_PUBKEY"

if [ ! -f "$VOTE_KEYPAIR" ]; then
    solana-keygen new --no-bip39-passphrase -o "$VOTE_KEYPAIR"
    echo "  Created vote keypair"
fi

if [ ! -f "$STAKE_KEYPAIR" ]; then
    solana-keygen new --no-bip39-passphrase -o "$STAKE_KEYPAIR"
    echo "  Created stake keypair"
fi
echo "  Done."

# ── Step 8: Configure validator ─────────────────────────────────────────────

echo "[8/10] Configuring validator..."

L2_RPC_URL="${MYTHIC_L2_RPC:-http://localhost:8999}"
SEQUENCER_URL="${MYTHIC_SEQUENCER_URL:-}"

solana config set --url "$L2_RPC_URL" --keypair "$VALIDATOR_KEYPAIR" > /dev/null 2>&1

# Create fdctl config for Firedancer (if available)
if [ -d "$FIREDANCER_DIR" ]; then
    cat > "$MYTHIC_DIR/fdctl-validator.toml" << EOF
[consensus]
identity_path = "$VALIDATOR_KEYPAIR"
vote_account_path = "$VOTE_KEYPAIR"

[rpc]
port = 8999
bind_address = "0.0.0.0"

[gossip]
entrypoints = []

[ledger]
path = "$MYTHIC_DIR/ledger"

[log]
path = "$MYTHIC_DIR/validator.log"
level_logfile = "INFO"
level_stderr = "WARN"
EOF

    if [ -n "$SEQUENCER_URL" ]; then
        echo "" >> "$MYTHIC_DIR/fdctl-validator.toml"
        echo "[gossip]" >> "$MYTHIC_DIR/fdctl-validator.toml"
        echo "entrypoints = [\"$SEQUENCER_URL\"]" >> "$MYTHIC_DIR/fdctl-validator.toml"
    fi
    echo "  Created fdctl-validator.toml"
fi

# Create systemd service file
sudo tee /etc/systemd/system/mythic-validator.service > /dev/null << EOF
[Unit]
Description=Mythic L2 Validator
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$MYTHIC_DIR
ExecStart=$MYTHIC_DIR/scripts/start-validator.sh
Restart=on-failure
RestartSec=10
LimitNOFILE=1000000

[Install]
WantedBy=multi-user.target
EOF

# Create the start script
cat > "$MYTHIC_DIR/scripts/start-validator.sh" << 'STARTEOF'
#!/bin/bash
set -euo pipefail
MYTHIC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

FIREDANCER_DIR="$MYTHIC_DIR/firedancer"
if [ -f "$FIREDANCER_DIR/build/native/gcc/bin/fdctl" ]; then
    exec "$FIREDANCER_DIR/build/native/gcc/bin/fdctl" run \
        --config "$MYTHIC_DIR/fdctl-validator.toml"
else
    exec solana-test-validator \
        --ledger "$MYTHIC_DIR/ledger" \
        --rpc-port 8999 \
        --faucet-port 9910 \
        --bpf-program MythBrdg11111111111111111111111111111111111 "$MYTHIC_DIR/target/deploy/mythic_bridge.so" \
        --bpf-program MythBrdgL2111111111111111111111111111111111 "$MYTHIC_DIR/target/deploy/mythic_bridge_l2.so" \
        --bpf-program CT1yUSX8n5uid5PyrPYnoG5H6Pp2GoqYGEKmMehq3uWJ "$MYTHIC_DIR/target/deploy/mythic_ai_precompiles.so" \
        --bpf-program AVWSp12ji5yoiLeC9whJv5i34RGF5LZozQin6T58vaEh "$MYTHIC_DIR/target/deploy/mythic_compute_market.so" \
        --bpf-program MythSett1ement11111111111111111111111111111 "$MYTHIC_DIR/target/deploy/mythic_settlement.so" \
        --bpf-program MythToken1111111111111111111111111111111111 "$MYTHIC_DIR/target/deploy/mythic_token.so" \
        --log "$MYTHIC_DIR/validator.log"
fi
STARTEOF
chmod +x "$MYTHIC_DIR/scripts/start-validator.sh"

sudo systemctl daemon-reload
echo "  Done."

# ── Step 9: AI Runtime (optional) ────────────────────────────────────────────

if [ "$AI_ENABLED" = true ]; then
    echo "[9/10] Setting up AI runtime..."

    # Install NVIDIA drivers
    if ! command -v nvidia-smi &>/dev/null; then
        echo "  Installing NVIDIA drivers..."
        sudo apt-get install -y -qq linux-headers-$(uname -r)

        # Add NVIDIA repo
        DISTRO=$(. /etc/os-release; echo "${ID}${VERSION_ID}" | tr -d '.')
        wget -q "https://developer.download.nvidia.com/compute/cuda/repos/${DISTRO}/x86_64/cuda-keyring_1.1-1_all.deb" -O /tmp/cuda-keyring.deb 2>/dev/null || true
        if [ -f /tmp/cuda-keyring.deb ]; then
            sudo dpkg -i /tmp/cuda-keyring.deb
            sudo apt-get update -qq
            sudo apt-get install -y -qq cuda-toolkit-12-4 nvidia-driver-550
            rm /tmp/cuda-keyring.deb
        else
            echo "  WARNING: Could not download CUDA keyring. Install NVIDIA drivers manually."
        fi
    else
        echo "  NVIDIA driver already installed: $(nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>/dev/null || echo 'unknown')"
    fi

    # Install CUDA toolkit paths
    if [ -d /usr/local/cuda ]; then
        export PATH="/usr/local/cuda/bin:$PATH"
        export LD_LIBRARY_PATH="/usr/local/cuda/lib64:${LD_LIBRARY_PATH:-}"
        if ! grep -q "cuda" "$HOME/.profile" 2>/dev/null; then
            echo 'export PATH="/usr/local/cuda/bin:$PATH"' >> "$HOME/.profile"
            echo 'export LD_LIBRARY_PATH="/usr/local/cuda/lib64:${LD_LIBRARY_PATH:-}"' >> "$HOME/.profile"
        fi
    fi

    # Create AI config
    cat > "$MYTHIC_DIR/ai-runtime.toml" << EOF
[ai]
enabled = true
max_concurrent_jobs = 4
gpu_memory_limit_mb = 8192
model_cache_dir = "$MYTHIC_DIR/ai-models"
supported_frameworks = ["onnx", "tensorrt"]
EOF

    mkdir -p "$MYTHIC_DIR/ai-models"
    echo "  AI runtime configured."
    echo "  Done."
else
    echo "[9/10] AI runtime: skipped (use --ai-enabled to install)"
fi

# ── Step 10: Register as validator ───────────────────────────────────────────

echo "[10/10] Validator registration..."
echo ""
echo "  To register this node as a validator, run:"
echo ""
echo "    # Set L2 RPC"
echo "    solana config set --url $L2_RPC_URL"
echo ""
echo "    # Create vote account (requires MYTH tokens)"
echo "    solana create-vote-account $VOTE_KEYPAIR $VALIDATOR_KEYPAIR"
echo ""
echo "    # Stake MYTH tokens"
echo "    solana create-stake-account $STAKE_KEYPAIR <AMOUNT>"
echo "    solana delegate-stake $STAKE_KEYPAIR $(solana-keygen pubkey $VOTE_KEYPAIR)"
echo ""
echo "    # Start the validator"
echo "    sudo systemctl enable mythic-validator"
echo "    sudo systemctl start mythic-validator"
echo ""

echo "=== Validator Setup Complete ==="
echo ""
echo "Validator Identity: $VALIDATOR_PUBKEY"
echo "Keypairs:"
echo "  Validator: $VALIDATOR_KEYPAIR"
echo "  Vote:      $VOTE_KEYPAIR"
echo "  Stake:     $STAKE_KEYPAIR"
echo ""
echo "Config:      $MYTHIC_DIR/fdctl-validator.toml"
echo "Service:     mythic-validator.service"
echo "Logs:        $MYTHIC_DIR/validator.log"
if [ "$AI_ENABLED" = true ]; then
    echo "AI Config:   $MYTHIC_DIR/ai-runtime.toml"
fi
