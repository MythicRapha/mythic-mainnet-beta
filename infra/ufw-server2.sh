#!/usr/bin/env bash
# ufw-server2.sh — Update UFW rules on Server 2 (20.49.10.158)
# Removes old Server 1 IP, adds new Server 1 IP, opens inter-server ports
#
# Run ON Server 2 as root or via sudo:
#   sudo bash /path/to/ufw-server2.sh
set -euo pipefail

OLD_SERVER1_IP="48.211.216.77"
NEW_SERVER1_IP="20.96.180.64"

echo "=== UFW Update for Server 2 (Mythic L2) ==="
echo "Old Server 1 IP: ${OLD_SERVER1_IP} (removing)"
echo "New Server 1 IP: ${NEW_SERVER1_IP} (adding)"
echo ""

# ── Step 1: Remove old Server 1 rules ──────────────────────────────────────

echo "[1/3] Removing rules for old IP ${OLD_SERVER1_IP}..."

# Delete all rules referencing the old IP (iterate in reverse to keep indices stable)
OLD_RULES=$(ufw status numbered 2>/dev/null | grep "${OLD_SERVER1_IP}" | awk -F'[][]' '{print $2}' | sort -rn || true)
if [ -n "${OLD_RULES}" ]; then
    for rule_num in ${OLD_RULES}; do
        echo "  Deleting rule #${rule_num}..."
        yes | ufw delete "${rule_num}" 2>/dev/null || true
    done
    echo "  Removed all rules for ${OLD_SERVER1_IP}."
else
    echo "  No existing rules found for ${OLD_SERVER1_IP}."
fi

# ── Step 2: Add new Server 1 rules ─────────────────────────────────────────

echo "[2/3] Adding rules for new IP ${NEW_SERVER1_IP}..."

# RPC access from Server 1
ufw allow from "${NEW_SERVER1_IP}" to any port 8899 proto tcp comment "Mythic L2 mainnet RPC from S1"
ufw allow from "${NEW_SERVER1_IP}" to any port 8900 proto tcp comment "Mythic L2 mainnet WS from S1"
ufw allow from "${NEW_SERVER1_IP}" to any port 8999 proto tcp comment "Mythic L2 testnet RPC from S1"
ufw allow from "${NEW_SERVER1_IP}" to any port 10000 proto tcp comment "Admin RPC from S1"

# Gossip / Validator inter-node ports
ufw allow from "${NEW_SERVER1_IP}" to any port 8001 proto tcp comment "Gossip TCP from S1"
ufw allow from "${NEW_SERVER1_IP}" to any port 8001 proto udp comment "Gossip UDP from S1"
ufw allow from "${NEW_SERVER1_IP}" to any port 8003 proto tcp comment "Repair TCP from S1"
ufw allow from "${NEW_SERVER1_IP}" to any port 8003 proto udp comment "Repair UDP from S1"

# Gossip/validator dynamic port range (turbine, repair serve, TPU)
ufw allow from "${NEW_SERVER1_IP}" to any port 8900:9100 proto tcp comment "Validator dynamic TCP from S1"
ufw allow from "${NEW_SERVER1_IP}" to any port 8900:9100 proto udp comment "Validator dynamic UDP from S1"

echo "  Added all inter-server rules."

# ── Step 3: Verify ─────────────────────────────────────────────────────────

echo "[3/3] Current UFW status:"
echo ""
ufw status verbose
echo ""
echo "=== UFW update complete ==="
echo "Server 2 can now communicate with Server 1 at ${NEW_SERVER1_IP}"
