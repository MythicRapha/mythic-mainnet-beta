#!/bin/bash
# build-mythic.sh — Build Mythic L2 from a Firedancer fork
# Usage: ./build-mythic.sh [--clean] [--jobs N]
#
# This script:
#   1. Clones Firedancer v0.812.30108 (if not already present)
#   2. Copies the Mythic L2 sequencer tile into the source tree
#   3. Applies topology modifications
#   4. Builds fdctl + solana binaries
#   5. Verifies the output

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MYTHIC_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
FIREDANCER_DIR="${MYTHIC_ROOT}/firedancer-src"
FIREDANCER_TAG="v0.812.30108"
FIREDANCER_REPO="https://github.com/firedancer-io/firedancer.git"
JOBS="${JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}"

CLEAN=0
for arg in "$@"; do
  case "$arg" in
    --clean) CLEAN=1 ;;
    --jobs)  shift; JOBS="$1" ;;
    --jobs=*) JOBS="${arg#--jobs=}" ;;
  esac
done

log() { echo "[mythic-build] $*"; }
err() { echo "[mythic-build] ERROR: $*" >&2; exit 1; }

# ---------------------------------------------------------------
# Step 1: Clone Firedancer
# ---------------------------------------------------------------

if [ ! -d "${FIREDANCER_DIR}/.git" ]; then
  log "Cloning Firedancer ${FIREDANCER_TAG} ..."
  git clone --depth 1 --branch "${FIREDANCER_TAG}" \
    "${FIREDANCER_REPO}" "${FIREDANCER_DIR}"
  cd "${FIREDANCER_DIR}"
  git submodule update --init --recursive --depth 1
else
  log "Firedancer source already present at ${FIREDANCER_DIR}"
  if [ "${CLEAN}" -eq 1 ]; then
    log "Cleaning previous build ..."
    cd "${FIREDANCER_DIR}"
    make clean || true
  fi
fi

cd "${FIREDANCER_DIR}"

# ---------------------------------------------------------------
# Step 2: Copy Mythic L2 sequencer tile into source tree
# ---------------------------------------------------------------

SEQUENCER_SRC="${MYTHIC_ROOT}/src/sequencer"
SEQUENCER_DST="${FIREDANCER_DIR}/src/sequencer"

log "Installing Mythic L2 sequencer tile ..."
mkdir -p "${SEQUENCER_DST}"
cp -v "${SEQUENCER_SRC}/fd_sequencer_tile.h" "${SEQUENCER_DST}/"
cp -v "${SEQUENCER_SRC}/fd_sequencer.h"      "${SEQUENCER_DST}/"
cp -v "${SEQUENCER_SRC}/fd_sequencer_tile.c" "${SEQUENCER_DST}/"

# Copy Mythic chain config
CONFIG_DST="${FIREDANCER_DIR}/config"
mkdir -p "${CONFIG_DST}"
cp -v "${MYTHIC_ROOT}/src/config/mythic_config.toml" "${CONFIG_DST}/"

# ---------------------------------------------------------------
# Step 3: Apply topology modifications
# ---------------------------------------------------------------

log "Applying topology modifications ..."

# 3a. Add sequencer tile type to fd_topo.h
TOPO_H="${FIREDANCER_DIR}/src/disco/topo/fd_topo.h"
if [ -f "${TOPO_H}" ] && ! grep -q "FD_TOPO_TILE_SEQUENCER" "${TOPO_H}"; then
  # Find the last FD_TOPO_TILE_ define and add ours after it
  LAST_TILE_LINE=$(grep -n "^#define FD_TOPO_TILE_" "${TOPO_H}" | tail -1 | cut -d: -f1)
  if [ -n "${LAST_TILE_LINE}" ]; then
    sed -i.bak "${LAST_TILE_LINE}a\\
#define FD_TOPO_TILE_SEQUENCER  (17)   /* Mythic L2 sequencer */" "${TOPO_H}"
    log "  Added FD_TOPO_TILE_SEQUENCER to fd_topo.h"
  else
    log "  WARNING: could not find FD_TOPO_TILE_ defines in fd_topo.h — manual edit required"
  fi
fi

# 3b. Add sequencer sources to build system
LOCAL_MK="${FIREDANCER_DIR}/src/sequencer/Local.mk"
if [ ! -f "${LOCAL_MK}" ]; then
  cat > "${LOCAL_MK}" << 'LOCALMK'
# Mythic L2 Sequencer Tile
$(call add-objs,src/sequencer/fd_sequencer_tile,fd_disco)
$(call add-hdrs,src/sequencer/fd_sequencer_tile.h src/sequencer/fd_sequencer.h)
LOCALMK
  log "  Created ${LOCAL_MK}"
fi

# 3c. Add include for sequencer in run.c (documented for manual application)
log "  NOTE: Manual edits to topology.c and run.c are documented in"
log "        ${MYTHIC_ROOT}/patches/topology-changes.md"
log "        These must be applied before the first production build."

# ---------------------------------------------------------------
# Step 4: Build
# ---------------------------------------------------------------

log "Building fdctl with ${JOBS} parallel jobs ..."
cd "${FIREDANCER_DIR}"

# Firedancer uses deps/ for third-party libraries
if [ ! -f "${FIREDANCER_DIR}/deps/.installed" ]; then
  log "Installing Firedancer build dependencies ..."
  make -j"${JOBS}" deps || log "WARNING: deps target failed — some deps may need manual install"
fi

make -j"${JOBS}" fdctl solana 2>&1 | tail -20

# ---------------------------------------------------------------
# Step 5: Verify output
# ---------------------------------------------------------------

FDCTL_BIN="${FIREDANCER_DIR}/build/native/gcc/bin/fdctl"
SOLANA_BIN="${FIREDANCER_DIR}/build/native/gcc/bin/solana"

if [ -x "${FDCTL_BIN}" ]; then
  log "SUCCESS: fdctl binary built at ${FDCTL_BIN}"
  log "  Version: $(${FDCTL_BIN} version 2>/dev/null || echo 'unknown')"
  log "  Size:    $(du -h "${FDCTL_BIN}" | cut -f1)"
else
  err "fdctl binary not found at ${FDCTL_BIN}"
fi

if [ -x "${SOLANA_BIN}" ]; then
  log "SUCCESS: solana binary built at ${SOLANA_BIN}"
else
  log "WARNING: solana binary not found (may be optional)"
fi

log ""
log "========================================"
log "  Mythic L2 Firedancer build complete"
log "========================================"
log ""
log "Next steps:"
log "  1. Apply manual topology edits (see patches/topology-changes.md)"
log "  2. Generate sequencer identity:  ${FDCTL_BIN} keygen new"
log "  3. Configure:  ${FDCTL_BIN} configure --config config/mythic_config.toml"
log "  4. Run:         ${FDCTL_BIN} run --config config/mythic_config.toml"
