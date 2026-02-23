#!/bin/bash
set -e

LOG=/tmp/full_rebuild.log
echo "=== Full Rebuild Started $(date) ===" > "$LOG"

cd /mnt/mythic

# 1. Clone Firedancer
echo "[1/4] Cloning Firedancer..." | tee -a "$LOG"
git clone --recurse-submodules https://github.com/firedancer-io/firedancer.git 2>&1 | tee -a "$LOG"
cd firedancer
git checkout v0.812.30108 2>&1 | tee -a "$LOG"
echo "Checked out v0.812.30108" | tee -a "$LOG"

# 2. Run deps
echo "[2/4] Building dependencies (deps.sh +dev)..." | tee -a "$LOG"
yes | ./deps.sh +dev 2>&1 | tee -a "$LOG"
echo "deps.sh done" | tee -a "$LOG"

# 3. Build fdctl
echo "[3/4] Building fdctl (make -j fdctl solana)..." | tee -a "$LOG"
make -j fdctl solana 2>&1 | tee -a "$LOG"
BUILD_EXIT=$?
echo "make exit: $BUILD_EXIT" | tee -a "$LOG"

if [ $BUILD_EXIT -ne 0 ]; then
    echo "BUILD_FAILED" >> "$LOG"
    exit 1
fi

# 4. Verify
echo "[4/4] Verifying..." | tee -a "$LOG"
ls -la build/native/gcc/bin/fdctl 2>&1 | tee -a "$LOG"
./build/native/gcc/bin/fdctl version 2>&1 | tee -a "$LOG"
echo "BUILD_SUCCESS" >> "$LOG"
echo "=== Complete $(date) ===" >> "$LOG"
