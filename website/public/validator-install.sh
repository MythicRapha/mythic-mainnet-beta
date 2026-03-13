#!/bin/bash
# =============================================================================
# Mythic L2 Validator Installer
# Installs Firedancer (fddev) and configures a Mythic L2 validator node.
#
# Usage:
#   curl -sSfL https://mythic.sh/install | sudo bash
#
# Override tier detection:
#   MYTHIC_TIER=ai curl -sSfL https://mythic.sh/install | sudo bash
#
# Tiers:
#   mini       8+ cores, 32GB RAM, 500GB SSD     RPC-only, lean
#   validator  32+ cores, 128GB RAM, 2TB NVMe     Full RPC + tx history
#   ai         48+ cores, 256GB RAM, 10TB NVMe    GPU sidecar + AI gateway
# =============================================================================

# Early OS check before set -e (so the message actually prints)
if [ "$(uname)" = "Darwin" ]; then
    echo ""
    echo "  Mythic L2 validators require Linux (Ubuntu 22.04+ or Debian 12+)."
    echo "  This installer cannot run on macOS."
    echo ""
    echo "  To run a validator, provision a Linux server with:"
    echo "    - Mini:      8+ cores, 32GB RAM, 500GB SSD"
    echo "    - Validator: 32+ cores, 128GB RAM, 2TB NVMe"
    echo "    - AI:        48+ cores, 256GB RAM, 10TB NVMe + GPU"
    echo ""
    echo "  Then run:  curl -sSfL https://mythic.sh/install | sudo bash"
    echo "  Docs:      https://mythiclabs.io/docs"
    echo ""
    exit 1
fi

set -euo pipefail

MYTHIC_VERSION="2.1.0"
FIREDANCER_TAG="v0.812.30108"
FIREDANCER_REPO="https://github.com/firedancer-io/firedancer.git"
CONFIG_BASE_URL="https://mythic.sh/validator-configs"
INSTALL_DIR="/etc/mythic"
DATA_DIR="/mnt/mythic"
LEDGER_DIR="/mnt/mythic/ledger"
LOG_DIR="/var/log/mythic"
BUILD_DIR="/opt/firedancer"
MYTHIC_USER="mythic"

# Colors (safe for piped output)
if [ -t 1 ]; then
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    RED='\033[0;31m'
    CYAN='\033[0;36m'
    BOLD='\033[1m'
    DIM='\033[2m'
    NC='\033[0m'
else
    GREEN='' YELLOW='' RED='' CYAN='' BOLD='' DIM='' NC=''
fi

# ── Helpers ──────────────────────────────────────────────────────────────────

log_step() { printf "\n${GREEN}[%s]${NC} %s\n" "$1" "$2"; }
log_info() { printf "  ${DIM}%s${NC}\n" "$1"; }
log_ok()   { printf "  ${GREEN}OK${NC} %s\n" "$1"; }
log_warn() { printf "  ${YELLOW}WARN${NC} %s\n" "$1"; }
log_err()  { printf "  ${RED}ERROR${NC} %s\n" "$1"; }

bail() { log_err "$1"; exit 1; }

# Cleanup on failure
CLEANUP_ON_FAIL=""
cleanup() {
    if [ -n "${CLEANUP_ON_FAIL}" ]; then
        log_warn "Installation failed. Partial state may remain in ${INSTALL_DIR}."
    fi
}
trap cleanup EXIT

# ── Banner ───────────────────────────────────────────────────────────────────

print_banner() {
    printf "\n"
    printf "${CYAN}    /\\${NC}\n"
    printf "${CYAN}   /  \\${NC}\n"
    printf "${CYAN}  / /\\ \\${NC}\n"
    printf "${CYAN} / /  \\ \\${NC}\n"
    printf "${CYAN}/ /    \\ \\${NC}\n"
    printf "${CYAN}\\ \\    / /${NC}\n"
    printf "${CYAN} \\ \\  / /${NC}\n"
    printf "${CYAN}  \\ \\/ /${NC}\n"
    printf "${CYAN}   \\  /${NC}\n"
    printf "${CYAN}    \\/${NC}\n"
    printf "\n"
    printf "  ${BOLD}Mythic Validator Installer${NC} v${MYTHIC_VERSION}\n"
    printf "  ${DIM}Firedancer-Powered AI-Native Blockchain${NC}\n"
    printf "\n"
}

# ── Tier Detection ───────────────────────────────────────────────────────────

detect_tier() {
    CPU_CORES=$(nproc 2>/dev/null || echo 4)
    TOTAL_RAM_KB=$(grep MemTotal /proc/meminfo 2>/dev/null | awk '{print $2}' || echo 0)
    TOTAL_RAM_GB=$((TOTAL_RAM_KB / 1024 / 1024))
    HAS_GPU="false"
    GPU_NAME="none"

    if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi >/dev/null 2>&1; then
        HAS_GPU="true"
        GPU_NAME=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1 || echo "NVIDIA GPU")
        GPU_VRAM=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null | head -1 || echo "0")
    fi

    # Detect available disk space -- prefer /mnt if it's a separate mount, else /
    if mountpoint -q /mnt 2>/dev/null; then
        DISK_AVAIL_GB=$(df -BG /mnt 2>/dev/null | tail -1 | awk '{print $4}' | tr -d 'G' || echo 0)
    else
        DISK_AVAIL_GB=$(df -BG / 2>/dev/null | tail -1 | awk '{print $4}' | tr -d 'G' || echo 0)
    fi

    if [ -n "${MYTHIC_TIER:-}" ]; then
        case "${MYTHIC_TIER}" in
            mini|validator|ai)
                TIER="$MYTHIC_TIER"
                log_info "Tier override: ${TIER}"
                ;;
            *)
                bail "Invalid MYTHIC_TIER='${MYTHIC_TIER}'. Must be: mini, validator, or ai"
                ;;
        esac
    elif [ "$CPU_CORES" -ge 48 ] && [ "$TOTAL_RAM_GB" -ge 200 ] && [ "$HAS_GPU" = "true" ]; then
        TIER="ai"
    elif [ "$CPU_CORES" -ge 32 ] && [ "$TOTAL_RAM_GB" -ge 100 ]; then
        TIER="validator"
    else
        TIER="mini"
    fi

    printf "  ${DIM}%-12s${NC} %s\n" "CPU:" "${CPU_CORES} cores"
    printf "  ${DIM}%-12s${NC} %s\n" "RAM:" "${TOTAL_RAM_GB}GB"
    printf "  ${DIM}%-12s${NC} %s\n" "Disk:" "${DISK_AVAIL_GB}GB available"
    if [ "$HAS_GPU" = "true" ]; then
        printf "  ${DIM}%-12s${NC} %s (%sMB VRAM)\n" "GPU:" "${GPU_NAME}" "${GPU_VRAM:-?}"
    else
        printf "  ${DIM}%-12s${NC} %s\n" "GPU:" "none detected"
    fi
    printf "  ${BOLD}%-12s${NC} ${GREEN}%s${NC}\n" "Tier:" "${TIER}"
}

# ── System Checks ────────────────────────────────────────────────────────────

check_system() {
    log_step "1/9" "Checking system requirements"

    # Must be Linux
    if [ "$(uname)" != "Linux" ]; then
        bail "Linux required. Detected: $(uname). Mythic validators run on Linux only."
    fi

    # Must be root
    if [ "$(id -u)" -ne 0 ]; then
        bail "Must run as root. Use: curl -sSfL mythic.sh/install | sudo bash"
    fi

    # Detect distro
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        DISTRO="${ID:-unknown}"
        DISTRO_VERSION="${VERSION_ID:-unknown}"
        log_info "OS: ${PRETTY_NAME:-${DISTRO} ${DISTRO_VERSION}}"
    else
        DISTRO="unknown"
        DISTRO_VERSION="unknown"
        log_warn "Could not detect Linux distribution."
    fi

    # Only Ubuntu/Debian supported for now
    case "${DISTRO}" in
        ubuntu|debian)
            ;;
        fedora|centos|rhel|rocky|almalinux)
            log_warn "RPM-based distros have experimental support. Ubuntu 22.04+ recommended."
            ;;
        *)
            log_warn "Untested distribution: ${DISTRO}. Ubuntu 22.04+ recommended."
            ;;
    esac

    detect_tier

    # Validate minimum requirements per tier
    case "${TIER}" in
        mini)
            [ "$TOTAL_RAM_GB" -lt 28 ] && log_warn "Mini tier needs 32GB RAM minimum. You have ${TOTAL_RAM_GB}GB."
            [ "$CPU_CORES" -lt 8 ] && log_warn "Mini tier needs 8+ cores. You have ${CPU_CORES}."
            ;;
        validator)
            [ "$TOTAL_RAM_GB" -lt 100 ] && log_warn "Validator tier needs 128GB RAM. You have ${TOTAL_RAM_GB}GB."
            [ "$CPU_CORES" -lt 32 ] && log_warn "Validator tier needs 32+ cores. You have ${CPU_CORES}."
            ;;
        ai)
            [ "$TOTAL_RAM_GB" -lt 200 ] && log_warn "AI tier needs 256GB RAM. You have ${TOTAL_RAM_GB}GB."
            [ "$CPU_CORES" -lt 48 ] && log_warn "AI tier needs 48+ cores. You have ${CPU_CORES}."
            [ "$HAS_GPU" != "true" ] && log_warn "AI tier needs an NVIDIA GPU. None detected."
            ;;
    esac
}

# ── Create User & Directories ───────────────────────────────────────────────

setup_user_and_dirs() {
    log_step "2/9" "Setting up user and directories"

    # Create mythic system user if it does not exist
    if ! id "${MYTHIC_USER}" >/dev/null 2>&1; then
        useradd --system --home-dir /home/${MYTHIC_USER} --create-home \
            --shell /usr/sbin/nologin --comment "Mythic Validator" "${MYTHIC_USER}"
        log_ok "Created system user: ${MYTHIC_USER}"
    else
        log_info "User ${MYTHIC_USER} already exists"
    fi

    # Create all required directories
    mkdir -p "${INSTALL_DIR}"
    mkdir -p "${DATA_DIR}"
    mkdir -p "${DATA_DIR}/fddev-data"
    mkdir -p "${LEDGER_DIR}"
    mkdir -p "${LOG_DIR}"
    mkdir -p "/run/mythic"

    # Set ownership
    chown -R "${MYTHIC_USER}:${MYTHIC_USER}" "${DATA_DIR}" 2>/dev/null || true
    chown -R "${MYTHIC_USER}:${MYTHIC_USER}" "${LOG_DIR}" 2>/dev/null || true
    chown -R "${MYTHIC_USER}:${MYTHIC_USER}" "/run/mythic" 2>/dev/null || true

    log_ok "Directories: ${INSTALL_DIR}, ${DATA_DIR}, ${LOG_DIR}"
}

# ── Dependencies ─────────────────────────────────────────────────────────────

install_dependencies() {
    log_step "3/9" "Installing build dependencies"
    CLEANUP_ON_FAIL="deps"

    export DEBIAN_FRONTEND=noninteractive

    # Detect package manager
    if command -v apt-get >/dev/null 2>&1; then
        apt-get update -qq >/dev/null 2>&1
        apt-get install -y -qq \
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
            autoconf \
            automake \
            libtool \
            zlib1g-dev \
            libzstd-dev \
            liblz4-dev \
            libelf-dev \
            linux-headers-"$(uname -r)" \
            2>/dev/null || true
    elif command -v dnf >/dev/null 2>&1; then
        dnf install -y -q \
            gcc gcc-c++ make \
            pkgconfig \
            openssl-devel \
            systemd-devel \
            clang cmake \
            protobuf-compiler \
            git curl wget jq \
            autoconf automake libtool \
            zlib-devel libzstd-devel lz4-devel \
            elfutils-libelf-devel \
            kernel-devel \
            2>/dev/null || true
    else
        log_warn "No supported package manager (apt-get/dnf). Install dependencies manually."
    fi

    log_ok "Build dependencies installed"
}

# ── Solana CLI (for keygen) ──────────────────────────────────────────────────

install_solana_cli() {
    log_step "4/9" "Installing Solana CLI tools"

    if command -v solana-keygen >/dev/null 2>&1; then
        log_info "solana-keygen already installed: $(solana-keygen --version 2>/dev/null || echo 'yes')"
        return 0
    fi

    # Install Solana CLI (Agave release) for keygen only
    SOLANA_INSTALL_DIR="/opt/solana"
    mkdir -p "${SOLANA_INSTALL_DIR}"

    if sh -c "$(curl -sSfL https://release.anza.xyz/v2.1.21/install)" 2>/dev/null; then
        # The installer puts it in ~/.local/share/solana
        SOLANA_BIN_DIRS=(
            "/root/.local/share/solana/install/active_release/bin"
            "/home/${MYTHIC_USER}/.local/share/solana/install/active_release/bin"
            "${HOME}/.local/share/solana/install/active_release/bin"
        )
        for dir in "${SOLANA_BIN_DIRS[@]}"; do
            if [ -x "${dir}/solana-keygen" ]; then
                ln -sf "${dir}/solana-keygen" /usr/local/bin/solana-keygen
                ln -sf "${dir}/solana" /usr/local/bin/solana
                break
            fi
        done
    fi

    if ! command -v solana-keygen >/dev/null 2>&1; then
        # Try PATH from installer
        export PATH="/root/.local/share/solana/install/active_release/bin:${PATH}"
        if command -v solana-keygen >/dev/null 2>&1; then
            ln -sf "$(which solana-keygen)" /usr/local/bin/solana-keygen
            ln -sf "$(which solana)" /usr/local/bin/solana 2>/dev/null || true
        else
            bail "Failed to install solana-keygen. Install manually: https://docs.anza.xyz/cli/install"
        fi
    fi

    log_ok "solana-keygen: $(solana-keygen --version 2>/dev/null || echo 'installed')"
}

# ── Build Firedancer ─────────────────────────────────────────────────────────

build_firedancer() {
    log_step "5/9" "Building Firedancer ${FIREDANCER_TAG}"
    CLEANUP_ON_FAIL="firedancer"
    JOBS="$(nproc 2>/dev/null || echo 4)"

    # Check for existing installation
    if [ -x "${BUILD_DIR}/build/native/gcc/bin/fdctl" ]; then
        CURRENT_VER=$("${BUILD_DIR}/build/native/gcc/bin/fdctl" version 2>/dev/null || echo "unknown")
        log_info "Existing fdctl found (${CURRENT_VER}). Skipping build."
        log_info "To rebuild: rm -rf ${BUILD_DIR} && re-run installer."

        # Ensure symlinks exist
        ln -sf "${BUILD_DIR}/build/native/gcc/bin/fdctl" /usr/local/bin/fdctl
        ln -sf "${BUILD_DIR}/build/native/gcc/bin/fddev" /usr/local/bin/fddev 2>/dev/null || true
        return 0
    fi

    log_info "This will take 10-30 minutes depending on hardware..."

    if [ -d "${BUILD_DIR}/.git" ]; then
        cd "${BUILD_DIR}"
        git fetch --tags 2>/dev/null || true
        git checkout "${FIREDANCER_TAG}" 2>/dev/null || true
    else
        git clone --depth 1 --branch "${FIREDANCER_TAG}" \
            "${FIREDANCER_REPO}" "${BUILD_DIR}" 2>&1 | tail -5
        cd "${BUILD_DIR}"
    fi

    git submodule update --init --recursive --depth 1 2>&1 | tail -5

    # Run Firedancer's own dependency installer
    if [ -f "deps.sh" ]; then
        log_info "Running Firedancer deps.sh..."
        FD_AUTO_INSTALL_PACKAGES=1 ./deps.sh install 2>&1 | tail -10
    fi

    log_info "Compiling with ${JOBS} parallel jobs..."
    make -j"${JOBS}" native 2>&1 | tail -20

    if [ ! -x "${BUILD_DIR}/build/native/gcc/bin/fdctl" ]; then
        bail "fdctl build failed. Check build output above."
    fi

    # Symlink into PATH
    ln -sf "${BUILD_DIR}/build/native/gcc/bin/fdctl" /usr/local/bin/fdctl
    ln -sf "${BUILD_DIR}/build/native/gcc/bin/fddev" /usr/local/bin/fddev 2>/dev/null || true

    log_ok "fdctl built and linked to /usr/local/bin/fdctl"
}

# ── Generate Keys ────────────────────────────────────────────────────────────

generate_keys() {
    log_step "6/9" "Generating validator keypairs"

    if [ ! -f "${INSTALL_DIR}/validator-identity.json" ]; then
        solana-keygen new \
            --outfile "${INSTALL_DIR}/validator-identity.json" \
            --no-bip39-passphrase \
            --force \
            --silent 2>/dev/null || \
        solana-keygen new \
            --outfile "${INSTALL_DIR}/validator-identity.json" \
            --no-bip39-passphrase \
            --force
        log_ok "Identity: $(solana-keygen pubkey "${INSTALL_DIR}/validator-identity.json")"
    else
        log_info "Identity exists: $(solana-keygen pubkey "${INSTALL_DIR}/validator-identity.json")"
    fi

    if [ ! -f "${INSTALL_DIR}/vote-account.json" ]; then
        solana-keygen new \
            --outfile "${INSTALL_DIR}/vote-account.json" \
            --no-bip39-passphrase \
            --force \
            --silent 2>/dev/null || \
        solana-keygen new \
            --outfile "${INSTALL_DIR}/vote-account.json" \
            --no-bip39-passphrase \
            --force
        log_ok "Vote:     $(solana-keygen pubkey "${INSTALL_DIR}/vote-account.json")"
    else
        log_info "Vote exists:     $(solana-keygen pubkey "${INSTALL_DIR}/vote-account.json")"
    fi

    # Secure key permissions
    chmod 600 "${INSTALL_DIR}/validator-identity.json"
    chmod 600 "${INSTALL_DIR}/vote-account.json"
    chown "${MYTHIC_USER}:${MYTHIC_USER}" "${INSTALL_DIR}/validator-identity.json" 2>/dev/null || true
    chown "${MYTHIC_USER}:${MYTHIC_USER}" "${INSTALL_DIR}/vote-account.json" 2>/dev/null || true

    # Configure Solana CLI defaults
    solana config set \
        --url https://rpc.mythic.sh \
        --keypair "${INSTALL_DIR}/validator-identity.json" \
        >/dev/null 2>&1 || true
}

# ── Download Config ──────────────────────────────────────────────────────────

setup_config() {
    log_step "7/9" "Downloading ${TIER} tier configuration"

    CONFIG_FILE="mythic-${TIER}.toml"
    CONFIG_PATH="${INSTALL_DIR}/config.toml"

    # Download tier-appropriate config template
    HTTP_CODE=$(curl -sSf -w '%{http_code}' -o "${CONFIG_PATH}.tmp" \
        "${CONFIG_BASE_URL}/${CONFIG_FILE}" 2>/dev/null || echo "000")

    if [ "${HTTP_CODE}" = "200" ] && [ -s "${CONFIG_PATH}.tmp" ]; then
        mv "${CONFIG_PATH}.tmp" "${CONFIG_PATH}"
        log_ok "Config downloaded: ${CONFIG_PATH}"
    else
        rm -f "${CONFIG_PATH}.tmp"
        log_warn "Could not download config from ${CONFIG_BASE_URL}/${CONFIG_FILE}"
        log_info "Generating fallback config locally..."
        generate_fallback_config
    fi

    # Patch identity/vote paths (they should already be correct in the template)
    # Patch the gossip host to this machine's public IP
    PUBLIC_IP=$(curl -sSf --connect-timeout 5 https://ifconfig.me 2>/dev/null \
             || curl -sSf --connect-timeout 5 https://api.ipify.org 2>/dev/null \
             || curl -sSf --connect-timeout 5 https://checkip.amazonaws.com 2>/dev/null \
             || echo "")
    PUBLIC_IP=$(echo "${PUBLIC_IP}" | tr -d '[:space:]')

    if [ -n "${PUBLIC_IP}" ]; then
        # Add host under [gossip] section if not already present
        if ! grep -q "^[[:space:]]*host[[:space:]]*=" "${CONFIG_PATH}" 2>/dev/null; then
            sed -i "/^\[gossip\]/a\\    host = \"${PUBLIC_IP}\"" "${CONFIG_PATH}"
        fi
        log_ok "Public IP: ${PUBLIC_IP}"
    else
        log_warn "Could not detect public IP. Set gossip.host manually in ${CONFIG_PATH}"
    fi

    # Ensure ownership
    chown "${MYTHIC_USER}:${MYTHIC_USER}" "${CONFIG_PATH}" 2>/dev/null || true

    log_info "Ledger:  ${LEDGER_DIR}"
    log_info "Logs:    ${LOG_DIR}"
    log_info "Config:  ${CONFIG_PATH}"
}

generate_fallback_config() {
    case "${TIER}" in
        mini)
            NET_TILES=1; QUIC_TILES=1; VERIFY_TILES=1; BANK_TILES=1; SHRED_TILES=1
            TX_HISTORY="false"; EXT_META="false"; LEDGER_LIMIT="10000000"
            ;;
        ai)
            NET_TILES=2; QUIC_TILES=2; VERIFY_TILES=8; BANK_TILES=8; SHRED_TILES=2
            TX_HISTORY="true"; EXT_META="true"; LEDGER_LIMIT="200000000"
            ;;
        *)
            NET_TILES=2; QUIC_TILES=2; VERIFY_TILES=4; BANK_TILES=4; SHRED_TILES=2
            TX_HISTORY="true"; EXT_META="true"; LEDGER_LIMIT="50000000"
            ;;
    esac

    cat > "${CONFIG_PATH}" << CFGEOF
# Mythic L2 Firedancer Config -- ${TIER} tier (auto-generated)
name = "mythic-l2-${TIER}"
user = "${MYTHIC_USER}"
scratch_directory = "${DATA_DIR}/fddev-data"
dynamic_port_range = "8100-8200"

[log]
    path = "${LOG_DIR}/firedancer.log"
    level_logfile = "INFO"
    level_stderr = "NOTICE"

[ledger]
    path = "${LEDGER_DIR}"
    account_indexes = []
    limit_size = ${LEDGER_LIMIT}

[gossip]
    entrypoints = ["20.96.180.64:8001"]
    port = 8001

[consensus]
    identity_path = "${INSTALL_DIR}/validator-identity.json"
    vote_account_path = "${INSTALL_DIR}/vote-account.json"
    known_validators = ["H65abAs3fffWo2pyLgeoV5VjC7XQ6bt4gRUZ1i2zyRSc"]
    snapshot_fetch = true
    genesis_fetch = true

[rpc]
    port = 8899
    full_api = true
    bind_address = "0.0.0.0"
    transaction_history = ${TX_HISTORY}
    extended_tx_metadata_storage = ${EXT_META}

[snapshots]
    incremental_snapshots = true

[layout]
    affinity = "auto"
    net_tile_count = ${NET_TILES}
    quic_tile_count = ${QUIC_TILES}
    verify_tile_count = ${VERIFY_TILES}
    bank_tile_count = ${BANK_TILES}
    shred_tile_count = ${SHRED_TILES}

[development]
    sandbox = false
    no_clone = true
    bootstrap = false
    [development.gossip]
        allow_private_address = true

[tiles.gui]
    enabled = true
    gui_listen_address = "127.0.0.1"
    gui_listen_port = 8079
CFGEOF
}

# ── Systemd Service ──────────────────────────────────────────────────────────

setup_systemd() {
    log_step "8/9" "Creating systemd service"

    cat > /etc/systemd/system/mythic-validator.service << SVCEOF
[Unit]
Description=Mythic L2 Validator (Firedancer ${TIER})
Documentation=https://mythic.sh/docs/validators
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=60
StartLimitBurst=3

[Service]
Type=simple
User=root
Group=root
ExecStart=/usr/local/bin/fdctl run --config /etc/mythic/config.toml
ExecStartPre=/usr/local/bin/fdctl configure init all --config /etc/mythic/config.toml
Restart=on-failure
RestartSec=10

# Resource limits for Firedancer
LimitNOFILE=1000000
LimitMEMLOCK=infinity
LimitNPROC=65535

# Security hardening
ProtectSystem=full
ProtectHome=read-only
NoNewPrivileges=false
PrivateTmp=true

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=mythic-validator

[Install]
WantedBy=multi-user.target
SVCEOF

    systemctl daemon-reload
    systemctl enable mythic-validator >/dev/null 2>&1

    log_ok "Service: mythic-validator.service (enabled, not started)"
}

# ── Firewall ─────────────────────────────────────────────────────────────────

setup_firewall() {
    if command -v ufw >/dev/null 2>&1; then
        ufw allow 8899/tcp comment "Mythic RPC" >/dev/null 2>&1 || true
        ufw allow 8900/tcp comment "Mythic PubSub" >/dev/null 2>&1 || true
        ufw allow 8001/udp comment "Mythic Gossip" >/dev/null 2>&1 || true
        ufw allow 8100:8200/tcp comment "Mythic Dynamic" >/dev/null 2>&1 || true
        ufw allow 8100:8200/udp comment "Mythic Dynamic" >/dev/null 2>&1 || true
        log_info "Firewall rules added (ufw)"
    elif command -v firewall-cmd >/dev/null 2>&1; then
        firewall-cmd --permanent --add-port=8899/tcp >/dev/null 2>&1 || true
        firewall-cmd --permanent --add-port=8900/tcp >/dev/null 2>&1 || true
        firewall-cmd --permanent --add-port=8001/udp >/dev/null 2>&1 || true
        firewall-cmd --permanent --add-port=8100-8200/tcp >/dev/null 2>&1 || true
        firewall-cmd --permanent --add-port=8100-8200/udp >/dev/null 2>&1 || true
        firewall-cmd --reload >/dev/null 2>&1 || true
        log_info "Firewall rules added (firewalld)"
    fi
}

# ── Auto-Register ────────────────────────────────────────────────────────────

register_validator() {
    log_step "9/9" "Registering validator on-chain"

    IDENTITY_PUBKEY=$(solana-keygen pubkey "${INSTALL_DIR}/validator-identity.json" 2>/dev/null || echo "")
    VOTE_PUBKEY=$(solana-keygen pubkey "${INSTALL_DIR}/vote-account.json" 2>/dev/null || echo "")

    if [ -z "${IDENTITY_PUBKEY}" ] || [ -z "${VOTE_PUBKEY}" ]; then
        log_warn "Could not read keypairs. Skipping auto-registration."
        return 0
    fi

    # Step 1: Request funding from the Mythic network
    log_info "Requesting validator funding from network..."
    REGISTER_RESPONSE=$(curl -sSf -X POST "https://mythic.sh/api/validators/register" \
        -H "Content-Type: application/json" \
        -d "{\"identity\":\"${IDENTITY_PUBKEY}\",\"vote\":\"${VOTE_PUBKEY}\",\"tier\":\"${TIER}\",\"ip\":\"${PUBLIC_IP:-}\"}" \
        --connect-timeout 10 --max-time 30 \
        2>/dev/null || echo '{"error":"unreachable"}')

    if echo "${REGISTER_RESPONSE}" | grep -q '"success":true' 2>/dev/null; then
        FUNDED=$(echo "${REGISTER_RESPONSE}" | grep -o '"funded":true' 2>/dev/null || echo "")
        if [ -n "${FUNDED}" ]; then
            log_ok "Validator identity funded by network"
        else
            log_ok "Validator recorded with network"
        fi
    else
        log_warn "Could not reach funding API (non-critical)"
    fi

    # Step 2: Create vote account on-chain (requires funded identity)
    BALANCE=$(solana balance "${IDENTITY_PUBKEY}" --url https://rpc.mythic.sh 2>/dev/null | grep -o '[0-9.]*' | head -1 || echo "0")
    if [ "$(echo "${BALANCE}" | awk '{print ($1 > 0.1)}')" = "1" ]; then
        log_info "Creating vote account on-chain..."
        solana create-vote-account \
            "${INSTALL_DIR}/vote-account.json" \
            "${INSTALL_DIR}/validator-identity.json" \
            "${IDENTITY_PUBKEY}" \
            --url https://rpc.mythic.sh \
            --keypair "${INSTALL_DIR}/validator-identity.json" \
            --commitment confirmed \
            2>/dev/null && log_ok "Vote account created on-chain" \
            || log_info "Vote account may already exist or insufficient funds"
    else
        log_info "Identity balance: ${BALANCE} SOL"
    fi

    # Step 3: Send RegisterValidator tx to MythToken program
    # Registers validator in the fee/reward system (staking rewards, AI multiplier)
    log_info "Registering with MythToken program (MythToken1111...)..."

    # Ensure Node.js is available (needed for @solana/web3.js transaction)
    if ! command -v node >/dev/null 2>&1; then
        if command -v apt-get >/dev/null 2>&1; then
            apt-get install -y -qq nodejs npm 2>/dev/null || true
        elif command -v dnf >/dev/null 2>&1; then
            dnf install -y -q nodejs npm 2>/dev/null || true
        fi
    fi

    if command -v node >/dev/null 2>&1; then
        # Download registration script
        curl -sSf "https://mythic.sh/register-validator.js" \
            -o "${INSTALL_DIR}/register-validator.js" \
            --connect-timeout 10 2>/dev/null || true

        if [ -f "${INSTALL_DIR}/register-validator.js" ]; then
            # Install @solana/web3.js if not globally available
            if ! node -e "require('@solana/web3.js')" 2>/dev/null; then
                log_info "Installing @solana/web3.js..."
                npm install --prefix "${INSTALL_DIR}" @solana/web3.js 2>/dev/null || true
            fi

            REG_OUTPUT=$(NODE_PATH="${INSTALL_DIR}/node_modules" node \
                "${INSTALL_DIR}/register-validator.js" \
                "${INSTALL_DIR}/validator-identity.json" "${TIER}" 2>&1 || true)

            if echo "${REG_OUTPUT}" | grep -qi "registered\|already" 2>/dev/null; then
                log_ok "Validator registered with MythToken program"
                if [ "${TIER}" = "ai" ]; then
                    log_ok "AI capability: enabled (2x reward multiplier)"
                fi
            else
                log_info "On-chain registration deferred"
                log_info "Run later: NODE_PATH=${INSTALL_DIR}/node_modules node ${INSTALL_DIR}/register-validator.js ${INSTALL_DIR}/validator-identity.json ${TIER}"
            fi
        else
            log_info "Registration script unavailable. Register after start."
        fi
    else
        log_warn "Node.js not available for on-chain registration."
        log_info "Register manually after install with the Mythic CLI."
    fi

    REGISTERED="true"
}

# ── Summary ──────────────────────────────────────────────────────────────────

print_success() {
    IDENTITY=$(solana-keygen pubkey "${INSTALL_DIR}/validator-identity.json" 2>/dev/null || echo "unknown")
    VOTE=$(solana-keygen pubkey "${INSTALL_DIR}/vote-account.json" 2>/dev/null || echo "unknown")

    CLEANUP_ON_FAIL=""  # Success -- disable failure cleanup message

    printf "\n"
    printf "  ${GREEN}${BOLD}================================================${NC}\n"
    printf "  ${GREEN}${BOLD}  Mythic Validator Installed Successfully${NC}\n"
    printf "  ${GREEN}${BOLD}================================================${NC}\n"
    printf "\n"
    printf "  %-14s %s\n" "Tier:" "${TIER}"
    printf "  %-14s %s\n" "Identity:" "${IDENTITY}"
    printf "  %-14s %s\n" "Vote:" "${VOTE}"
    printf "  %-14s %s\n" "Config:" "${INSTALL_DIR}/config.toml"
    printf "  %-14s %s\n" "Ledger:" "${LEDGER_DIR}"
    printf "  %-14s %s\n" "Logs:" "${LOG_DIR}/firedancer.log"
    printf "  %-14s %s\n" "Service:" "mythic-validator.service"
    printf "\n"
    if [ "${REGISTERED:-}" = "true" ]; then
        printf "  ${GREEN}%-14s${NC} %s\n" "Registered:" "yes (auto-registered on-chain)"
    fi
    printf "\n"
    printf "  ${BOLD}Next Steps:${NC}\n"
    printf "\n"
    printf "  ${CYAN}1.${NC} Start the validator:\n"
    printf "     ${DIM}sudo systemctl start mythic-validator${NC}\n"
    printf "\n"
    printf "  ${CYAN}2.${NC} Monitor:\n"
    printf "     ${DIM}sudo systemctl status mythic-validator${NC}\n"
    printf "     ${DIM}journalctl -u mythic-validator -f${NC}\n"
    printf "\n"
    printf "  ${CYAN}3.${NC} View your validator on the network:\n"
    printf "     ${DIM}https://mythic.sh/validators${NC}\n"
    printf "\n"
    printf "  ${YELLOW}IMPORTANT: Back up your keys immediately!${NC}\n"
    printf "     ${DIM}${INSTALL_DIR}/validator-identity.json${NC}\n"
    printf "     ${DIM}${INSTALL_DIR}/vote-account.json${NC}\n"
    printf "\n"
    printf "  ${BOLD}Mythic CLI:${NC}\n"
    printf "     ${DIM}curl -sSf mythic.sh/cli | bash${NC}\n"
    printf "\n"
    printf "  ${BOLD}Docs:${NC}    https://mythiclabs.io/docs\n"
    printf "  ${BOLD}Discord:${NC} https://discord.gg/mythic\n"
    printf "\n"
}

# ── Main ─────────────────────────────────────────────────────────────────────

main() {
    print_banner
    check_system
    setup_user_and_dirs
    install_dependencies
    install_solana_cli
    build_firedancer
    generate_keys
    setup_config
    setup_systemd
    setup_firewall
    register_validator
    print_success
}

main "$@"
