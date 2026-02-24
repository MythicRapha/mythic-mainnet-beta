#!/usr/bin/env python3
"""Calculate exact SOL costs for deploying the L1 bridge program."""

so_size = 142448  # bytes from server

# Solana program deployment allocates 2x the .so size
program_data_len = 45 + so_size * 2  # programdata header + data

# Rent: minimum_balance(len) ≈ 0.00000348 * (128 + len) + some base
# More accurately from Solana: (len + 128) * 3480 / 1e9 * 2 (2 years)
def rent(data_len):
    return (data_len + 128) * 6960 / 1e9

rent_programdata = rent(program_data_len)

# Config PDA rent (123 bytes)
rent_config = rent(123)

# SPL Token ATA rent (~165 bytes)  
rent_vault = rent(165)

# Transaction fees (~4 txns for deploy writes, 1 init, 1 vault create)
tx_fees = 0.00001 * 30  # ~30 txs for deploy writes (each ~1232 bytes, need ~116 writes)

total_needed = rent_programdata + rent_config + rent_vault + tx_fees
print(f"Program data rent:   {rent_programdata:.6f} SOL (2x {so_size} bytes)")
print(f"Config PDA rent:     {rent_config:.6f} SOL")
print(f"Vault ATA rent:      {rent_vault:.6f} SOL")
print(f"Transaction fees:    {tx_fees:.6f} SOL (estimate)")
print(f"---")
print(f"Total needed:        ~{total_needed:.4f} SOL")
print(f"From 4 SOL budget:   ~{4 - total_needed:.4f} SOL remaining to return")
