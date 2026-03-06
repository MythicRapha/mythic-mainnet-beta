# Mythic Bridge Fast Exit System

## Problem

L2-to-L1 withdrawals currently require a ~42 hour challenge period (151,200 seconds) before
funds can be claimed on Solana mainnet. This is a standard optimistic rollup security
mechanism, but the wait time is a poor user experience for small withdrawals.

## Solution: Sequencer-Guaranteed Fast Exits

For withdrawals up to 10 SOL equivalent, the sequencer (relayer) pre-funds the L1
withdrawal immediately from a reserve pool. The user receives funds on L1 within ~30
minutes. The sequencer then waits out the challenge period and claims from the bridge
contract to replenish its reserve.

## Architecture Overview

```
User initiates L2 -> L1 withdrawal (BridgeToL1 instruction on L2)
         |
         v
    Relayer detects BridgeToL1 event on L2
         |
         +--- Amount <= FAST_EXIT_MAX (10 SOL equiv)?
         |        |
         |   YES: Fast Exit Path          NO: Standard Path
         |        |                            |
         |        v                            v
         |   Send SOL directly to         Initiate withdrawal on L1
         |   user on L1 from reserve      (42h challenge period)
         |   (immediate transfer)              |
         |        |                            v
         |        v                       After challenge period,
         |   Record fast-exit in DB       user/anyone calls
         |   (nonce, amount, fee)         FinalizeWithdrawal
         |        |
         |        v
         |   Also initiate standard withdrawal on L1
         |   (to reclaim funds after challenge period)
         |        |
         |        v
         |   After 42h, call FinalizeWithdrawal
         |   to replenish reserve
         v
    User gets funds on L1
```

## On-Chain Flow

### Fast Exit (< 30 min)

1. User calls `BridgeToL1` on L2 bridge program
   - MYTH transferred to bridge reserve PDA
   - Event emitted: `EVENT:BridgeToL1:{sender, l1_recipient, amount, withdraw_nonce}`

2. Relayer detects event, checks eligibility:
   - Amount <= 10 SOL equivalent (scaled from MYTH via oracle/hardcoded rate)
   - Reserve pool has sufficient balance
   - User not rate-limited (max 3 fast exits per hour per wallet)
   - Global fast exit volume not exceeded (100 SOL/day cap)

3. Relayer sends SOL/MYTH directly to user on L1:
   - Simple `SystemProgram.transfer` from relayer's L1 reserve wallet
   - No on-chain program interaction needed for the fast payout

4. Relayer also initiates standard withdrawal on L1 bridge:
   - Calls `InitiateWithdrawal` as normal (starts 42h challenge period)
   - After challenge period, calls `FinalizeWithdrawal` to reclaim funds

### Standard Exit (42 hours)

Unchanged from current flow. The relayer calls `InitiateWithdrawal` on L1, and after
the challenge period anyone can call `FinalizeWithdrawal`.

## Fee Structure

| Amount Range       | Fee    | Rationale                              |
|-------------------|--------|----------------------------------------|
| 0 - 1 SOL equiv  | 0.3%   | Higher fee for small amounts (capital cost) |
| 1 - 5 SOL equiv  | 0.2%   | Mid-range                              |
| 5 - 10 SOL equiv | 0.1%   | Lower fee for larger amounts           |
| > 10 SOL equiv   | N/A    | Standard exit only (no fast exit)      |

Minimum fee: 0.001 SOL (to cover transaction costs).

## Rate Limiting

- **Per-wallet**: Maximum 3 fast exits per rolling 1-hour window
- **Global daily cap**: 100 SOL equivalent total fast-exit volume per day
- **Reserve floor**: Fast exits disabled if reserve drops below 5 SOL
- **Cooldown**: If a fast exit fails or is challenged, that wallet is blocked for 24 hours

## Reserve Pool Management

The relayer maintains a separate L1 reserve wallet for fast exits:

- **Target balance**: 50 SOL
- **Minimum balance**: 5 SOL (fast exits disabled below this)
- **Replenishment**: Automated via FinalizeWithdrawal after challenge periods expire
- **Manual top-up**: Admin can send SOL to the reserve wallet
- **Accounting**: SQLite database tracks all fast exits, pending reclaims, and reserve balance

### Reserve Wallet

A separate keypair from the relayer's main sequencer keypair:
- `FAST_EXIT_RESERVE_KEYPAIR_PATH` environment variable
- Holds SOL for immediate payouts
- Never used for sequencer operations

## Relayer Code Changes

### New Environment Variables

```
FAST_EXIT_ENABLED=true
FAST_EXIT_MAX_SOL=10
FAST_EXIT_RESERVE_KEYPAIR_PATH=/path/to/fast-exit-reserve.json
FAST_EXIT_DAILY_CAP_SOL=100
FAST_EXIT_RESERVE_FLOOR_SOL=5
FAST_EXIT_DB_PATH=fast_exit_state.json
```

### Fast Exit Processing (TypeScript pseudocode)

```typescript
interface FastExitRecord {
  withdrawNonce: number;
  l2Sender: string;
  l1Recipient: string;
  amountLamports: number;
  feeLamports: number;
  fastExitTxSignature: string;
  standardWithdrawalNonce: number;
  status: 'paid' | 'reclaiming' | 'reclaimed' | 'failed';
  paidAt: number;       // unix timestamp
  reclaimedAt?: number;
}

interface FastExitState {
  records: FastExitRecord[];
  dailyVolumeLamports: number;
  dailyVolumeResetAt: number;
  walletCooldowns: Record<string, number[]>; // wallet -> timestamps of recent fast exits
}

function isEligibleForFastExit(
  event: BridgeToL1Event,
  state: FastExitState,
  reserveBalance: number,
): { eligible: boolean; fee: number; reason?: string } {
  const amountSol = event.amount / LAMPORTS_PER_SOL;

  // Check amount cap
  if (amountSol > FAST_EXIT_MAX_SOL) {
    return { eligible: false, fee: 0, reason: 'Amount exceeds fast exit limit' };
  }

  // Check reserve balance
  if (reserveBalance < event.amount + RESERVE_FLOOR) {
    return { eligible: false, fee: 0, reason: 'Insufficient reserve' };
  }

  // Check daily cap
  const now = Date.now() / 1000;
  if (now - state.dailyVolumeResetAt > 86400) {
    state.dailyVolumeLamports = 0;
    state.dailyVolumeResetAt = now;
  }
  if (state.dailyVolumeLamports + event.amount > DAILY_CAP_LAMPORTS) {
    return { eligible: false, fee: 0, reason: 'Daily fast exit cap reached' };
  }

  // Check per-wallet rate limit
  const recentExits = (state.walletCooldowns[event.sender] || [])
    .filter(t => now - t < 3600);
  if (recentExits.length >= 3) {
    return { eligible: false, fee: 0, reason: 'Wallet rate limit (3/hr)' };
  }

  // Calculate fee
  const fee = calculateFastExitFee(event.amount);

  return { eligible: true, fee };
}

function calculateFastExitFee(amountLamports: number): number {
  const amountSol = amountLamports / LAMPORTS_PER_SOL;
  let bps: number;
  if (amountSol <= 1) bps = 30;       // 0.3%
  else if (amountSol <= 5) bps = 20;  // 0.2%
  else bps = 10;                       // 0.1%

  const fee = Math.floor((amountLamports * bps) / 10000);
  return Math.max(fee, 1_000_000); // min 0.001 SOL
}

async function processFastExit(
  event: BridgeToL1Event,
  l1Client: Connection,
  reserveKeypair: Keypair,
  fee: number,
): Promise<string> {
  const recipient = new PublicKey(event.l1_recipient);
  const payoutAmount = event.amount - fee;

  // Direct SOL transfer from reserve to user on L1
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: reserveKeypair.publicKey,
      toPubkey: recipient,
      lamports: payoutAmount,
    })
  );

  const sig = await sendAndConfirmTransaction(l1Client, tx, [reserveKeypair]);
  return sig;
}
```

### Modified Relayer Loop (Rust changes in relayer/src/main.rs)

The `poll_l2_burns` function is modified to check fast exit eligibility before
initiating the standard withdrawal:

```rust
// In poll_l2_burns, after parsing BridgeToL1 event:

// Check fast exit eligibility
let amount_sol = event.amount as f64 / 1_000_000_000.0;
let is_fast_exit_eligible = fast_exit_enabled
    && amount_sol <= fast_exit_max_sol
    && reserve_balance >= event.amount + reserve_floor
    && daily_volume + event.amount <= daily_cap
    && wallet_rate_ok(&event.sender);

if is_fast_exit_eligible {
    // 1. Send SOL directly to user on L1 (fast payout)
    let fee = calculate_fast_exit_fee(event.amount);
    let payout = event.amount - fee;

    let fast_exit_ix = system_instruction::transfer(
        &reserve_keypair.pubkey(),
        &l1_recipient,
        payout,
    );
    // ... sign and send on L1 ...

    // 2. Also initiate standard withdrawal (for reserve replenishment)
    let withdrawal_ix = build_initiate_withdrawal_ix(...);
    // ... sign and send on L1 ...

    // 3. Record in state
    fast_exit_state.record(FastExitRecord { ... });
}
```

### Reserve Reclamation Loop

A new background thread in the relayer that periodically checks for withdrawals
past their challenge period and calls `FinalizeWithdrawal` to reclaim funds:

```rust
fn reclaim_loop(l1_client: &RpcClient, config: &RelayerConfig, state: &FastExitState) {
    for record in state.records.iter().filter(|r| r.status == "paid") {
        // Check if challenge period has expired
        let withdrawal = fetch_withdrawal_request(l1_client, record.standard_withdrawal_nonce);
        if withdrawal.status == Pending && clock.unix_timestamp >= withdrawal.challenge_deadline {
            // Call FinalizeWithdrawal or FinalizeSOLWithdrawal
            let ix = build_finalize_withdrawal_ix(...);
            // ... sign and send ...
            record.status = "reclaimed";
        }
    }
}
```

## Frontend Integration

### BridgeCard.tsx Changes

When `direction === 'withdraw'`:
- Show a toggle: "Fast Exit (< 30 min)" vs "Standard Exit (~42 hours)"
- Fast Exit is auto-selected when amount <= 10 SOL equivalent
- Display fast exit fee (tiered 0.1-0.3%)
- Show estimated arrival time
- Grey out Fast Exit toggle for amounts > 10 SOL

### useBridge.ts Changes

- New state: `fastExitEnabled`, `fastExitMode` ('fast' | 'standard')
- New computed: `fastExitFee`, `fastExitEligible`
- `withdrawFromL2` passes the fast exit preference as metadata in the withdrawal
  (the relayer decides server-side, but the UI shows the expected path)

## Security Considerations

1. **Double-spend prevention**: The relayer records all fast exits in persistent storage.
   If the relayer restarts, it checks existing records before paying out.

2. **Challenge risk**: If a fast exit withdrawal is challenged (fraud proof submitted),
   the relayer loses the pre-funded amount. Mitigation:
   - Only the sequencer can initiate withdrawals, so challenges require actual fraud
   - The sequencer/relayer is operated by the team, so fraud is not expected
   - Reserve cap limits maximum exposure

3. **Reserve exhaustion**: Rate limits and daily caps prevent draining the reserve.
   The reserve floor (5 SOL) ensures there's always funds for transaction fees.

4. **Front-running**: The relayer is the only entity that can execute fast exits.
   No on-chain MEV risk since the payout is a simple transfer.

## Monitoring

- Log all fast exits with full details (nonce, amount, fee, signatures)
- Track reserve balance and alert if below 10 SOL
- Dashboard endpoint: `GET /api/fast-exit/status` returns:
  - Reserve balance
  - Daily volume / cap
  - Pending reclaims count
  - Recent fast exits

## Rollout Plan

1. Deploy with `FAST_EXIT_ENABLED=false` initially
2. Fund reserve wallet with 50 SOL
3. Enable with low cap (10 SOL/day) for testing
4. Increase to 100 SOL/day after 48 hours of monitoring
5. Monitor reserve replenishment cycle (first reclaim after 42h)
