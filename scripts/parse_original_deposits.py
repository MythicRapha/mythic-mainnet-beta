#!/usr/bin/env python3
"""Parse original deposit amounts from old relayer logs."""
import json, re, os, sys

logfiles = [
    os.path.expanduser("~/.pm2/logs/mythic-relayer-out__2026-02-24_00-00-00.log"),
    os.path.expanduser("~/.pm2/logs/mythic-relayer-out__2026-02-25_00-00-00.log"),
    os.path.expanduser("~/.pm2/logs/mythic-relayer-out__2026-02-26_00-00-00.log"),
    os.path.expanduser("~/.pm2/logs/mythic-relayer-out__2026-02-27_00-00-00.log"),
    os.path.expanduser("~/.pm2/logs/mythic-relayer-out__2026-02-28_00-00-00.log"),
    os.path.expanduser("~/.pm2/logs/mythic-relayer-out__2026-03-01_00-00-00.log"),
]

deposits = {}

for logfile in logfiles:
    if not os.path.exists(logfile):
        continue
    with open(logfile) as f:
        current_nonce = None
        for line in f:
            line = line.strip()
            # Try JSON parse
            try:
                d = json.loads(line)
                nonce = d.get("nonce")
                if nonce is not None:
                    n = int(nonce)
                    current_nonce = n
                    if "l2MythAmount" in d:
                        deposits[n] = d["l2MythAmount"]
                    elif "mythL2Readable" in d:
                        deposits[n] = d["mythL2Readable"]
                continue
            except:
                pass
            # Formatted log - extract nonce
            m = re.search(r'nonce[^"]*"(\d+)"', line)
            if m:
                current_nonce = int(m.group(1))
            # Extract l2MythAmount
            m = re.search(r'l2MythAmount[^"]*"([0-9.]+)"', line)
            if m and current_nonce is not None and current_nonce not in deposits:
                deposits[current_nonce] = m.group(1)
            # Extract mythL2Readable
            m = re.search(r'mythL2Readable[^"]*"([0-9.]+)"', line)
            if m and current_nonce is not None and current_nonce not in deposits:
                deposits[current_nonce] = m.group(1)

for nonce in sorted(deposits.keys()):
    val = deposits[nonce]
    print("nonce=%3d original_myth=%s" % (nonce, val))
