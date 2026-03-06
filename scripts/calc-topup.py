#!/usr/bin/env python3
"""
Calculate the MYTH top-up needed for each user whose SOL deposit was
re-processed at the wrong rate after genesis rebuild.

Compares original processing amounts (from old relayer logs) with
re-processed amounts (from current L2 transactions).
"""
import json, re, os, subprocess, sys
from collections import defaultdict

# ── Step 1: Parse ALL original deposit amounts from old logs ─────────────

logfiles = [
    os.path.expanduser("~/.pm2/logs/mythic-relayer-out__2026-02-24_00-00-00.log"),
    os.path.expanduser("~/.pm2/logs/mythic-relayer-out__2026-02-25_00-00-00.log"),
    os.path.expanduser("~/.pm2/logs/mythic-relayer-out__2026-02-26_00-00-00.log"),
    os.path.expanduser("~/.pm2/logs/mythic-relayer-out__2026-02-27_00-00-00.log"),
    os.path.expanduser("~/.pm2/logs/mythic-relayer-out__2026-02-28_00-00-00.log"),
    os.path.expanduser("~/.pm2/logs/mythic-relayer-out__2026-03-01_00-00-00.log"),
    os.path.expanduser("~/.pm2/logs/mythic-relayer-out.log"),
]

# Map: l1_tx_sig -> {original_myth, method, nonce}
original_by_sig = {}
# Map: nonce -> {l2MythAmount, l1TxSig, method}
original_by_nonce = {}

for logfile in logfiles:
    if not os.path.exists(logfile):
        continue
    with open(logfile) as f:
        current_nonce = None
        for line in f:
            line = line.strip()
            try:
                d = json.loads(line)
                nonce = d.get("nonce")
                l1sig = d.get("l1TxSig", "")
                if nonce is not None:
                    n = int(nonce)
                    current_nonce = n
                    myth_amount = d.get("l2MythAmount") or d.get("mythL2Readable")
                    method = d.get("method", "unknown")
                    if myth_amount and l1sig:
                        if n not in original_by_nonce:
                            original_by_nonce[n] = {
                                "myth": float(myth_amount),
                                "l1sig": l1sig,
                                "method": method,
                            }
                            original_by_sig[l1sig] = {
                                "myth": float(myth_amount),
                                "nonce": n,
                                "method": method,
                            }
                continue
            except:
                pass
            # Formatted log
            m = re.search(r'nonce[^"]*"(\d+)"', line)
            if m:
                current_nonce = int(m.group(1))
            # Don't parse formatted entries for original amounts -
            # they're ambiguous with re-processing entries

# ── Step 2: Get deposits from DB ─────────────────────────────────────────

import sqlite3
db = sqlite3.connect("/mnt/data/mythic-relayer/data/relayer.db")
db.row_factory = sqlite3.Row
deposits = db.execute(
    "SELECT id, l1_tx_signature, recipient_l2, asset, amount_lamports, status, l2_tx_signature FROM deposits ORDER BY created_at"
).fetchall()

# ── Step 3: For completed SOL deposits, get re-processed amounts from L2 ─

RESERVE_PDA = "G1gb6Kuycj7FkdGWtLJ2fngqAmtJiLy89bkKUBvHZAVg"

def get_l2_credit(l2_tx_sig):
    """Get the MYTH amount credited from an L2 transaction."""
    if not l2_tx_sig:
        return None
    try:
        result = subprocess.run(
            ["curl", "-s", "http://localhost:8899", "-X", "POST",
             "-H", "Content-Type: application/json",
             "-d", json.dumps({
                 "jsonrpc": "2.0", "id": 1,
                 "method": "getTransaction",
                 "params": [l2_tx_sig, {"encoding": "jsonParsed"}]
             })],
            capture_output=True, text=True, timeout=10
        )
        data = json.loads(result.stdout)
        if data.get("result"):
            tx = data["result"]
            meta = tx.get("meta", {})
            pre = meta.get("preBalances", [])
            post = meta.get("postBalances", [])
            keys = tx["transaction"]["message"]["accountKeys"]
            for i, k in enumerate(keys):
                pk = k if isinstance(k, str) else k.get("pubkey", "")
                if pk == RESERVE_PDA and i < len(pre) and i < len(post):
                    diff = post[i] - pre[i]
                    if diff < 0:
                        return abs(diff) / 1e9  # lamports to MYTH
        return None
    except:
        return None

# ── Step 4: Build comparison ─────────────────────────────────────────────

print("=" * 100)
print("DEPOSIT RATE COMPARISON: Original vs Re-processed")
print("=" * 100)

# Per-recipient shortfall tracking
recipient_shortfall = defaultdict(float)  # hex_recipient -> total shortfall in MYTH
recipient_overcredit = defaultdict(float)  # hex_recipient -> total overcredit in MYTH

sol_deposits_completed = []

for dep in deposits:
    if dep["asset"] != "SOL":
        continue  # MYTH deposits are exact, no rate issue

    l1sig = dep["l1_tx_signature"]
    recipient = dep["recipient_l2"]
    sol_amount = dep["amount_lamports"] / 1e9
    status = dep["status"]
    l2_tx = dep["l2_tx_signature"]

    # Find original amount
    original = original_by_sig.get(l1sig)
    original_myth = original["myth"] if original else None
    nonce = original["nonce"] if original else "?"

    if status == "completed" and l2_tx:
        # Get re-processed amount from L2 transaction
        reprocessed_myth = get_l2_credit(l2_tx)

        if original_myth and reprocessed_myth:
            diff = original_myth - reprocessed_myth
            if diff > 0:
                recipient_shortfall[recipient] += diff
                marker = "UNDERCREDITED"
            elif diff < -1:  # More than 1 MYTH overcredit
                recipient_overcredit[recipient] += abs(diff)
                marker = "OVERCREDITED"
            else:
                marker = "OK"

            print("nonce=%3s SOL=%.4f orig=%12.4f repro=%12.4f diff=%+12.4f %s recipient=%s" % (
                nonce, sol_amount, original_myth, reprocessed_myth, -diff, marker, recipient[:16]))
            sol_deposits_completed.append({
                "nonce": nonce,
                "recipient": recipient,
                "original": original_myth,
                "reprocessed": reprocessed_myth,
                "diff": diff,
            })
        elif original_myth:
            print("nonce=%3s SOL=%.4f orig=%12.4f repro=NOT FOUND recipient=%s" % (
                nonce, sol_amount, original_myth, recipient[:16]))
        else:
            print("nonce=??? SOL=%.4f ORIGINAL NOT FOUND l1sig=%s... recipient=%s" % (
                sol_amount, l1sig[:20], recipient[:16]))

    elif status == "pending":
        if original_myth:
            recipient_shortfall[recipient] += original_myth
            print("nonce=%3s SOL=%.4f orig=%12.4f PENDING (never re-credited) recipient=%s" % (
                nonce, sol_amount, original_myth, recipient[:16]))
        else:
            print("nonce=??? SOL=%.4f PENDING, NO ORIGINAL AMOUNT l1sig=%s... recipient=%s" % (
                sol_amount, l1sig[:20], recipient[:16]))

# ── Step 5: Summary per recipient ────────────────────────────────────────

print()
print("=" * 100)
print("PER-RECIPIENT SUMMARY")
print("=" * 100)

# Convert hex recipients to base58 pubkeys
def hex_to_pubkey(hex_str):
    try:
        import base64
        raw = bytes.fromhex(hex_str)
        # base58 encode
        alphabet = b'123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
        n = int.from_bytes(raw, 'big')
        result = b''
        while n > 0:
            n, r = divmod(n, 58)
            result = bytes([alphabet[r]]) + result
        # Add leading zeros
        for byte in raw:
            if byte == 0:
                result = bytes([alphabet[0]]) + result
            else:
                break
        return result.decode()
    except:
        return hex_str[:16] + "..."

total_topup = 0
topup_commands = []

for recipient in sorted(set(list(recipient_shortfall.keys()) + list(recipient_overcredit.keys()))):
    shortfall = recipient_shortfall.get(recipient, 0)
    overcredit = recipient_overcredit.get(recipient, 0)
    net = shortfall - overcredit
    pubkey = hex_to_pubkey(recipient)

    if net > 1:  # More than 1 MYTH shortfall
        total_topup += net
        lamports = int(net * 1e9)
        print("  %s: shortfall=%.4f overcredit=%.4f NET TOP-UP=%.4f MYTH (%d lamports)" % (
            pubkey, shortfall, overcredit, net, lamports))
        topup_commands.append((pubkey, net, lamports))
    elif net < -1:
        print("  %s: shortfall=%.4f overcredit=%.4f NET OVERCREDIT=%.4f MYTH (small, ignore)" % (
            pubkey, shortfall, overcredit, abs(net)))
    else:
        print("  %s: balanced (diff < 1 MYTH)" % pubkey)

print()
print("TOTAL TOP-UP NEEDED: %.4f MYTH (%d lamports)" % (total_topup, int(total_topup * 1e9)))

# ── Step 6: Generate transfer commands ───────────────────────────────────

if topup_commands:
    print()
    print("=" * 100)
    print("SOLANA TRANSFER COMMANDS (run from deployer key)")
    print("=" * 100)
    for pubkey, myth, lamports in topup_commands:
        sol_equiv = myth / 1e9  # MYTH in SOL terms for solana transfer
        print()
        print("# Top up %s with %.4f MYTH" % (pubkey, myth))
        print("solana transfer %s %.9f --keypair /mnt/data/mythic-l2/keys/deployer.json --fee-payer /mnt/data/mythic-l2/keys/deployer.json --allow-unfunded-recipient" % (pubkey, myth))

db.close()
