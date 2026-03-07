#!/usr/bin/env bash
# build-frankendancer.sh — Build Frankendancer (Firedancer) v0.812.30108 on Server 1
#
# Run ON Server 1 (20.96.180.64):
#   bash /mnt/data/mythic-l2/infra/build-frankendancer.sh
set -euo pipefail

FIREDANCER_TAG="v0.812.30108"
FIREDANCER_REPO="https://github.com/firedancer-io/firedancer.git"
BUILD_DIR="/mnt/data/firedancer"
JOBS="$(nproc 2>/dev/null || echo 8)"

echo "=== Build Frankendancer ${FIREDANCER_TAG} ==="
echo "Build dir: ${BUILD_DIR}"
echo "Parallel jobs: ${JOBS}"
echo ""

# ── Step 1: System dependencies ────────────────────────────────────────────

echo "[1/5] Installing system dependencies..."
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
    autoconf \
    automake \
    libtool \
    zlib1g-dev \
    libzstd-dev \
    liblz4-dev \
    libelf-dev \
    linux-headers-"$(uname -r)" \
    2>/dev/null || true
echo "  Done."

# ── Step 2: Clone Firedancer ───────────────────────────────────────────────

echo "[2/5] Cloning Firedancer ${FIREDANCER_TAG}..."
if [ -d "${BUILD_DIR}/.git" ]; then
    echo "  Existing clone found at ${BUILD_DIR}. Checking tag..."
    cd "${BUILD_DIR}"
    CURRENT_TAG=$(git describe --tags --exact-match 2>/dev/null || echo "none")
    if [ "${CURRENT_TAG}" = "${FIREDANCER_TAG}" ]; then
        echo "  Already on ${FIREDANCER_TAG}."
    else
        echo "  Fetching and checking out ${FIREDANCER_TAG}..."
        git fetch --tags
        git checkout "${FIREDANCER_TAG}"
    fi
else
    git clone --depth 1 --branch "${FIREDANCER_TAG}" \
        "${FIREDANCER_REPO}" "${BUILD_DIR}"
    cd "${BUILD_DIR}"
fi

echo "  Initializing submodules..."
git submodule update --init --recursive --depth 1
echo "  Done."

# ── Step 3: Install Firedancer dependencies ────────────────────────────────

echo "[3/5] Installing Firedancer build dependencies (deps.sh)..."
cd "${BUILD_DIR}"

# Firedancer uses deps.sh for vendored dependencies
if [ -f "deps.sh" ]; then
    FD_AUTO_INSTALL_PACKAGES=1 ./deps.sh install
elif [ -f "Makefile" ] && grep -q "deps" Makefile; then
    make -j"${JOBS}" deps
else
    echo "  WARNING: No deps.sh or deps target found. Build may fail."
fi
echo "  Done."

# ── Step 4: Build ──────────────────────────────────────────────────────────

echo "[4/5] Building Frankendancer (make -j${JOBS} native)..."
cd "${BUILD_DIR}"

# Full native build (fdctl, fddev, solana validator binaries)
make -j"${JOBS}" native 2>&1 | tail -30

echo "  Done."

# ── Step 5: Verify ─────────────────────────────────────────────────────────

echo "[5/5] Verifying build outputs..."
FDCTL="${BUILD_DIR}/build/native/gcc/bin/fdctl"

if [ -x "${FDCTL}" ]; then
    echo "  fdctl binary: ${FDCTL}"
    echo "  Size: $(du -h "${FDCTL}" | cut -f1)"
    echo "  Version: $(${FDCTL} version 2>/dev/null || echo 'built successfully')"
else
    echo "  ERROR: fdctl not found at ${FDCTL}"
    echo "  Checking build directory..."
    find "${BUILD_DIR}/build" -name "fdctl" -type f 2>/dev/null || echo "  No fdctl binary found anywhere."
    exit 1
fi

echo ""
echo "=== Frankendancer build complete ==="
echo ""
echo "Binary: ${FDCTL}"
echo ""
echo "Next steps:"
echo "  1. Configure: fdctl configure --config /mnt/data/mythic-l2/infra/fdancer-s1-mainnet.toml"
echo "  2. Run:       fdctl run --config /mnt/data/mythic-l2/infra/fdancer-s1-mainnet.toml"
