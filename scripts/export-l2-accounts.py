#!/usr/bin/env python3
"""
Export all accounts from stuck Frankendancer L2 RPC.
Saves each account in solana-test-validator --account JSON format.
"""

import json
import os
import sys
import base64
import urllib.request

RPC_URL = "http://localhost:8899"
EXPORT_DIR = "/mnt/data/mythic-l2/account-export"

# Programs to export accounts for
PROGRAMS = {
    "MythBrdgL2111111111111111111111111111111111": "bridge-l2",
    "MythSwap11111111111111111111111111111111111": "swap",
    "MythStak11111111111111111111111111111111111": "staking",
    "MythToken1111111111111111111111111111111111": "myth-token",
    "MythSett1ement11111111111111111111111111111": "settlement",
    "MythGov111111111111111111111111111111111111": "governance",
    "MythPad111111111111111111111111111111111111": "launchpad",
    "MythDrop11111111111111111111111111111111111": "airdrop",
    "CT1yUSX8n5uid5PyrPYnoG5H6Pp2GoqYGEKmMehq3uWJ": "ai-precompiles",
    "AVWSp12ji5yoiLeC9whJv5i34RGF5LZozQin6T58vaEh": "compute-market",
    "MythBrdg11111111111111111111111111111111111": "bridge-l1",
}

# SPL Token Program
SPL_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"

# Known mints to export directly
MINTS = [
    "7sfazeMxmuoDkuU5fHkDGin8uYuaTkZrRSwJM1CHXvDq",  # MYTH
    "FEJa8wGyhXu9Hic1jNTg76Atb57C7jFkmDyDTQZkVwy3",  # wSOL
    "6QTVHn4TUPQSpCH1uGmAK1Vd6JhuSEeKMKSi1F1SZMN",  # USDC
    "8Go32n5Pv4HYdML9DNr8ePh4UHunqS9ZgjKMurz1vPSw",  # wBTC
    "4zmzPzkexJRCVKSrYCHpmP8TVX6kMobjiFu8dVKtuXGT",  # wETH
]

# Key addresses to export (for native lamport balances)
KEY_ADDRESSES = [
    "DLB2NZ5PSNAoChQAaUCBwoHCf6vzeStDa6kCYbB8HjSg",  # Sequencer
    "4pPDuqj4bJjjti3398MhwUvQgPR4Azo6sEeZAhHhsk6s",  # Deployer
    "AnVqSYE3ArJX9ZCbiReFcNa2JdLyri3GGGt34j63hT9e",  # Foundation
    "DEAbjmnC5uy1RjnVAxEjL4sbXToZAiEqvCC7XGYuDkkF",  # Validator PDA
]

# Deployed swap program (upgradeable)
EXTRA_PROGRAMS = [
    "3QB8S38ouuREEDPxnaaGeujLsUhwFoRbLAejKywtEgv7",  # Swap v3
]


def rpc_call(method, params):
    """Make an RPC call to the local Frankendancer."""
    payload = json.dumps({
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params
    }).encode()
    req = urllib.request.Request(
        RPC_URL,
        data=payload,
        headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read())
    except Exception as e:
        print(f"  RPC error: {e}", file=sys.stderr)
        return None


def save_account(pubkey, account_data, subdir=""):
    """Save account in solana-test-validator --account JSON format."""
    out_dir = os.path.join(EXPORT_DIR, subdir) if subdir else EXPORT_DIR
    os.makedirs(out_dir, exist_ok=True)

    # solana-test-validator expects this format:
    account_json = {
        "pubkey": pubkey,
        "account": {
            "lamports": account_data["lamports"],
            "data": account_data["data"],
            "owner": account_data["owner"],
            "executable": account_data["executable"],
            "rentEpoch": account_data.get("rentEpoch", 18446744073709551615),
            "space": account_data.get("space", 0)
        }
    }

    filepath = os.path.join(out_dir, f"{pubkey}.json")
    with open(filepath, "w") as f:
        json.dump(account_json, f, indent=2)
    return filepath


def export_program_accounts(program_id, label):
    """Export all accounts owned by a program."""
    print(f"\n[{label}] getProgramAccounts({program_id})")
    result = rpc_call("getProgramAccounts", [
        program_id,
        {"encoding": "base64", "withContext": True}
    ])
    if not result or "result" not in result:
        # Try without withContext
        result = rpc_call("getProgramAccounts", [
            program_id,
            {"encoding": "base64"}
        ])
    if not result:
        print(f"  ERROR: No response")
        return 0

    accounts = result.get("result", [])
    if isinstance(accounts, dict) and "value" in accounts:
        accounts = accounts["value"]

    count = 0
    for acct in accounts:
        pubkey = acct["pubkey"]
        save_account(pubkey, acct["account"], subdir=label)
        count += 1

    print(f"  Exported {count} accounts")
    return count


def export_single_account(pubkey, label="individual"):
    """Export a single account by address."""
    result = rpc_call("getAccountInfo", [
        pubkey,
        {"encoding": "base64"}
    ])
    if not result or "result" not in result:
        print(f"  {pubkey}: ERROR no response")
        return False

    account_info = result["result"]
    if isinstance(account_info, dict) and "value" in account_info:
        account_info = account_info["value"]

    if account_info is None:
        print(f"  {pubkey}: account not found")
        return False

    save_account(pubkey, account_info, subdir=label)
    lamports = account_info["lamports"]
    owner = account_info["owner"]
    print(f"  {pubkey}: {lamports} lamports, owner={owner}")
    return True


def main():
    os.makedirs(EXPORT_DIR, exist_ok=True)

    # Check RPC health
    slot_result = rpc_call("getSlot", [])
    if not slot_result:
        print("ERROR: RPC not responding")
        sys.exit(1)
    print(f"Connected to RPC at slot {slot_result.get('result', '?')}")

    total = 0

    # 1. Export all program accounts
    print("\n=== PROGRAM ACCOUNTS ===")
    for program_id, label in PROGRAMS.items():
        total += export_program_accounts(program_id, label)

    # 2. Export SPL Token accounts
    print("\n=== SPL TOKEN ACCOUNTS ===")
    total += export_program_accounts(SPL_TOKEN_PROGRAM, "spl-token")

    # 3. Export mint accounts individually
    print("\n=== MINT ACCOUNTS ===")
    for mint in MINTS:
        if export_single_account(mint, "mints"):
            total += 1

    # 4. Export key wallet addresses (for native balances)
    print("\n=== KEY WALLETS (native balances) ===")
    for addr in KEY_ADDRESSES:
        if export_single_account(addr, "wallets"):
            total += 1

    # 5. Export extra program accounts (upgradeable swap)
    print("\n=== EXTRA PROGRAM ACCOUNTS ===")
    for prog in EXTRA_PROGRAMS:
        total += export_program_accounts(prog, "extra-programs")
        # Also export the program account itself (executable)
        if export_single_account(prog, "executables"):
            total += 1
        # Export program data account (BPF upgradeable)
        result = rpc_call("getAccountInfo", [prog, {"encoding": "base64"}])
        if result and result.get("result", {}).get("value"):
            data = result["result"]["value"]["data"]
            if isinstance(data, list) and len(data[0]) > 50:
                # This is a BPF upgradeable program, try to get programdata
                pass

    # 6. Generate summary
    print(f"\n=== SUMMARY ===")
    print(f"Total accounts exported: {total}")
    print(f"Export directory: {EXPORT_DIR}")

    # Count by subdirectory
    for root, dirs, files in os.walk(EXPORT_DIR):
        json_files = [f for f in files if f.endswith('.json')]
        if json_files:
            rel = os.path.relpath(root, EXPORT_DIR)
            print(f"  {rel}: {len(json_files)} accounts")

    # 7. Generate the --account flags for solana-test-validator
    print("\n=== SOLANA-TEST-VALIDATOR FLAGS ===")
    flags_file = os.path.join(EXPORT_DIR, "test-validator-flags.txt")
    with open(flags_file, "w") as f:
        for root, dirs, files in os.walk(EXPORT_DIR):
            for fname in sorted(files):
                if fname.endswith('.json') and fname != "test-validator-flags.txt":
                    filepath = os.path.join(root, fname)
                    pubkey = fname.replace('.json', '')
                    f.write(f"--account {pubkey} {filepath} \\\n")
    print(f"Flags written to: {flags_file}")


if __name__ == "__main__":
    main()
