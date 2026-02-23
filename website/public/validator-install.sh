#!/bin/sh
set -e

MYTHIC_VERSION="1.0.0"
REPO_URL="https://github.com/MythicL2/mythic-validator"
INSTALL_DIR="${MYTHIC_HOME:-$HOME/.mythic}"
LEDGER_DIR="${MYTHIC_LEDGER:-/mnt/mythic/ledger}"
LOG_DIR="/var/log/mythic"

print_banner() {
    echo ""
    echo "    ╱╲"
    echo "   ╱  ╲"
    echo "  ╱ ╱╲ ╲"
    echo " ╱ ╱  ╲ ╲"
    echo "╱ ╱    ╲ ╲"
    echo "╲ ╲    ╱ ╱"
    echo " ╲ ╲  ╱ ╱"
    echo "  ╲ ╲╱ ╱"
    echo "   ╲  ╱"
    echo "    ╲╱"
    echo ""
    echo "  Mythic Validator Installer v${MYTHIC_VERSION}"
    echo "  The AI-Native Blockchain"
    echo ""
}

check_requirements() {
    echo "[1/7] Checking system requirements..."

    # Check OS
    if [ "$(uname)" != "Linux" ]; then
        echo "Error: Linux required (detected $(uname))"
        exit 1
    fi

    # Check RAM (minimum 64GB)
    TOTAL_RAM_KB=$(grep MemTotal /proc/meminfo | awk '{print $2}')
    TOTAL_RAM_GB=$((TOTAL_RAM_KB / 1024 / 1024))
    if [ "$TOTAL_RAM_GB" -lt 32 ]; then
        echo "Warning: ${TOTAL_RAM_GB}GB RAM detected. Minimum 64GB recommended."
    fi
    echo "  RAM: ${TOTAL_RAM_GB}GB ✓"

    # Check CPU cores
    CPU_CORES=$(nproc)
    echo "  CPU: ${CPU_CORES} cores ✓"

    # Check disk
    echo "  OS: $(cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2 | tr -d '"') ✓"
}

install_dependencies() {
    echo "[2/7] Installing dependencies..."
    sudo apt-get update -qq
    sudo apt-get install -y -qq curl git build-essential pkg-config libssl-dev libudev-dev
}

install_solana() {
    echo "[3/7] Installing Solana CLI..."
    if ! command -v solana >/dev/null 2>&1; then
        sh -c "$(curl -sSfL https://release.anza.xyz/v2.1.0/install)"
        export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
    fi
    echo "  Solana: $(solana --version) ✓"
}

install_mythic_cli() {
    echo "[4/7] Installing Mythic CLI..."
    if command -v npm >/dev/null 2>&1; then
        npm install -g @mythic/cli 2>/dev/null || true
    fi
    # Fallback: download from mythic.sh
    curl -sSfL https://mythic.sh/releases/mythic-cli-latest.tgz -o /tmp/mythic-cli.tgz 2>/dev/null || true
}

generate_keys() {
    echo "[5/7] Generating validator keys..."
    mkdir -p "$INSTALL_DIR"

    if [ ! -f "$INSTALL_DIR/validator-identity.json" ]; then
        solana-keygen new --outfile "$INSTALL_DIR/validator-identity.json" --no-bip39-passphrase --force
        echo "  Identity: $(solana-keygen pubkey "$INSTALL_DIR/validator-identity.json") ✓"
    else
        echo "  Identity: $(solana-keygen pubkey "$INSTALL_DIR/validator-identity.json") (existing) ✓"
    fi

    if [ ! -f "$INSTALL_DIR/vote-account.json" ]; then
        solana-keygen new --outfile "$INSTALL_DIR/vote-account.json" --no-bip39-passphrase --force
        echo "  Vote: $(solana-keygen pubkey "$INSTALL_DIR/vote-account.json") ✓"
    fi

    # Set Mythic config
    solana config set --url https://rpc.mythic.sh --keypair "$INSTALL_DIR/validator-identity.json" >/dev/null 2>&1
}

setup_systemd() {
    echo "[6/7] Setting up systemd service..."
    sudo mkdir -p "$LOG_DIR" "$LEDGER_DIR"
    sudo chown "$(whoami)" "$LOG_DIR" "$LEDGER_DIR"

    sudo tee /etc/systemd/system/mythic-validator.service > /dev/null << SVCEOF
[Unit]
Description=Mythic L2 Validator
After=network.target
StartLimitIntervalSec=0

[Service]
Type=simple
User=$(whoami)
Environment=PATH=$HOME/.local/share/solana/install/active_release/bin:/usr/bin:/bin
ExecStart=$HOME/.local/share/solana/install/active_release/bin/solana-validator \\
    --identity $INSTALL_DIR/validator-identity.json \\
    --vote-account $INSTALL_DIR/vote-account.json \\
    --ledger $LEDGER_DIR \\
    --rpc-port 8899 \\
    --dynamic-port-range 8900-8920 \\
    --entrypoint rpc.mythic.sh:8001 \\
    --expected-genesis-hash MYTHIC_GENESIS_HASH \\
    --limit-ledger-size 50000000 \\
    --log $LOG_DIR/validator.log \\
    --no-os-network-limits-test \\
    --full-rpc-api \\
    --enable-rpc-transaction-history
Restart=on-failure
RestartSec=5
LimitNOFILE=1000000

[Install]
WantedBy=multi-user.target
SVCEOF

    sudo systemctl daemon-reload
    sudo systemctl enable mythic-validator
}

print_success() {
    echo "[7/7] Done!"
    echo ""
    echo "  ┌─────────────────────────────────────────────┐"
    echo "  │        Mythic Validator Installed            │"
    echo "  └─────────────────────────────────────────────┘"
    echo ""
    echo "  Identity:  $(solana-keygen pubkey "$INSTALL_DIR/validator-identity.json")"
    echo "  Vote:      $(solana-keygen pubkey "$INSTALL_DIR/vote-account.json")"
    echo "  Ledger:    $LEDGER_DIR"
    echo "  Logs:      $LOG_DIR/validator.log"
    echo ""
    echo "  Start:     sudo systemctl start mythic-validator"
    echo "  Status:    sudo systemctl status mythic-validator"
    echo "  Logs:      journalctl -u mythic-validator -f"
    echo ""
    echo "  IMPORTANT: Back up your keys!"
    echo "  $INSTALL_DIR/validator-identity.json"
    echo "  $INSTALL_DIR/vote-account.json"
    echo ""
    echo "  Docs: https://mythic.sh/docs"
    echo "  Discord: https://discord.gg/mythic"
    echo ""
}

main() {
    print_banner
    check_requirements
    install_dependencies
    install_solana
    install_mythic_cli
    generate_keys
    setup_systemd
    print_success
}

main "$@"
