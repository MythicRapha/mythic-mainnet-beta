import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import pino from "pino";
import { CONFIG, SEEDS } from "./config";
import {
  deriveConfigPDA,
  deriveInferencePDA,
  deriveValidatorPDA,
  submitResult,
  claimFee,
  sha256,
} from "./chain";
import { engine } from "./inference";

const log = pino({ level: CONFIG.logLevel });

// ---------------------------------------------------------------
// On-chain event watcher — polls for new InferenceRequest accounts
// ---------------------------------------------------------------

interface PendingRequest {
  pubkey: PublicKey;
  nonce: bigint;
  requester: PublicKey;
  modelHash: Buffer;
  inputHash: Buffer;
  maxFee: bigint;
  createdAt: number;
}

interface CompletedRequest {
  pubkey: PublicKey;
  completedAt: number;
  claimed: boolean;
}

const CHALLENGE_WINDOW_SLOTS = 100;
const POLL_INTERVAL_MS = 2000;

export class ChainWatcher {
  private connection: Connection;
  private keypair: Keypair;
  private lastProcessedNonce: bigint = BigInt(0);
  private pendingClaims: CompletedRequest[] = [];
  private running = false;
  private configPDA: PublicKey;
  private validatorPDA: PublicKey;
  private escrowVault: PublicKey | null = null;
  private foundationPubkey: PublicKey | null = null;
  private burnAddress: PublicKey | null = null;

  constructor(connection: Connection, keypair: Keypair) {
    this.connection = connection;
    this.keypair = keypair;
    [this.configPDA] = deriveConfigPDA();
    [this.validatorPDA] = deriveValidatorPDA(keypair.publicKey);
  }

  async start(): Promise<void> {
    this.running = true;

    // Load config from chain to get foundation/burn addresses
    await this.loadConfig();

    log.info(
      {
        validator: this.keypair.publicKey.toBase58(),
        validatorPDA: this.validatorPDA.toBase58(),
        configPDA: this.configPDA.toBase58(),
      },
      "Chain watcher starting"
    );

    // Start polling loops
    this.pollForRequests();
    this.pollForClaims();
  }

  stop(): void {
    this.running = false;
    log.info("Chain watcher stopped");
  }

  private async loadConfig(): Promise<void> {
    try {
      const configData = await this.connection.getAccountInfo(this.configPDA);
      if (!configData?.data) {
        log.warn("AI config not initialized on chain — will retry");
        return;
      }

      // Parse AIConfig (borsh): is_initialized(1) + admin(32) + registration_fee(8) + min_stake(8) + request_nonce(8) + burn_address(32) + foundation(32) + is_paused(1) + bump(1)
      const data = configData.data;
      let offset = 1; // skip is_initialized
      offset += 32; // skip admin
      offset += 8; // skip registration_fee
      offset += 8; // skip min_stake

      // Read request nonce
      this.lastProcessedNonce = data.readBigUInt64LE(offset);
      offset += 8;

      // Read burn address
      this.burnAddress = new PublicKey(data.subarray(offset, offset + 32));
      offset += 32;

      // Read foundation
      this.foundationPubkey = new PublicKey(data.subarray(offset, offset + 32));

      log.info(
        {
          currentNonce: this.lastProcessedNonce.toString(),
          foundation: this.foundationPubkey.toBase58(),
          burn: this.burnAddress.toBase58(),
        },
        "Loaded AI config from chain"
      );
    } catch (err) {
      log.error({ err }, "Failed to load AI config");
    }
  }

  private async pollForRequests(): Promise<void> {
    while (this.running) {
      try {
        // Re-read the current nonce from config
        const configData = await this.connection.getAccountInfo(this.configPDA);
        if (!configData?.data) {
          await this.sleep(POLL_INTERVAL_MS);
          continue;
        }

        const currentNonce = configData.data.readBigUInt64LE(1 + 32 + 8 + 8);

        // Process any new requests
        for (
          let n = this.lastProcessedNonce;
          n < currentNonce;
          n++
        ) {
          await this.processRequest(n);
        }

        this.lastProcessedNonce = currentNonce;
      } catch (err) {
        log.error({ err }, "Error polling for requests");
      }

      await this.sleep(POLL_INTERVAL_MS);
    }
  }

  private async processRequest(nonce: bigint): Promise<void> {
    const [requestPDA] = deriveInferencePDA(nonce);

    try {
      const requestData = await this.connection.getAccountInfo(requestPDA);
      if (!requestData?.data) return;

      // Parse InferenceRequest
      const data = requestData.data;
      let offset = 0;

      const requester = new PublicKey(data.subarray(offset, offset + 32));
      offset += 32;

      const modelHash = Buffer.from(data.subarray(offset, offset + 32));
      offset += 32;

      const inputHash = Buffer.from(data.subarray(offset, offset + 32));
      offset += 32;

      const maxOutputLen = data.readUInt32LE(offset);
      offset += 4;

      const maxFee = data.readBigUInt64LE(offset);
      offset += 8;

      const escrowedAmount = data.readBigUInt64LE(offset);
      offset += 8;

      const status = data[offset]; // 0=Pending
      offset += 1;

      // Only process Pending requests (status == 0)
      if (status !== 0) {
        log.debug({ nonce: nonce.toString(), status }, "Skipping non-pending request");
        return;
      }

      // Check if we support this model
      const modelHashHex = modelHash.toString("hex");
      const supportedModels = engine.getModelHashes().map((h) => h.toString("hex"));

      if (
        CONFIG.supportedModels.length > 0 &&
        !CONFIG.supportedModels.includes(modelHashHex) &&
        supportedModels.length > 0 &&
        !supportedModels.includes(modelHashHex)
      ) {
        log.debug(
          { nonce: nonce.toString(), modelHash: modelHashHex.slice(0, 16) },
          "Skipping request — model not supported"
        );
        return;
      }

      log.info(
        {
          nonce: nonce.toString(),
          requester: requester.toBase58(),
          maxFee: maxFee.toString(),
          maxOutputLen,
        },
        "Processing inference request"
      );

      // Run inference
      // In production, the input data is stored off-chain (IPFS/Arweave) with inputHash as reference
      // For now we use a placeholder input — the real input would come from the gateway API
      const result = await engine.runInference(
        modelHashHex,
        `Inference request ${nonce.toString()} for model ${modelHashHex.slice(0, 8)}`,
        maxOutputLen
      );

      // Submit result on-chain
      const sig = await submitResult(
        this.connection,
        this.keypair,
        requestPDA,
        this.validatorPDA,
        result.outputHash,
        result.logitFingerprint,
        result.computeUnits
      );

      // Track for fee claiming
      const slot = await this.connection.getSlot();
      this.pendingClaims.push({
        pubkey: requestPDA,
        completedAt: slot,
        claimed: false,
      });

      log.info(
        {
          nonce: nonce.toString(),
          sig,
          tokensGenerated: result.tokensGenerated,
          latencyMs: result.latencyMs,
        },
        "Inference completed and result submitted"
      );
    } catch (err) {
      log.error({ err, nonce: nonce.toString() }, "Error processing request");
    }
  }

  private async pollForClaims(): Promise<void> {
    while (this.running) {
      try {
        const currentSlot = await this.connection.getSlot();

        for (const claim of this.pendingClaims) {
          if (claim.claimed) continue;

          const slotsSince = currentSlot - claim.completedAt;
          if (slotsSince >= CHALLENGE_WINDOW_SLOTS) {
            await this.tryClaimFee(claim);
          }
        }

        // Clean up old claims
        this.pendingClaims = this.pendingClaims.filter((c) => !c.claimed);
      } catch (err) {
        log.error({ err }, "Error polling for claims");
      }

      await this.sleep(10000); // Check every 10s
    }
  }

  private async tryClaimFee(claim: CompletedRequest): Promise<void> {
    if (!this.foundationPubkey || !this.burnAddress) {
      log.warn("Foundation/burn addresses not loaded — skipping claim");
      return;
    }

    try {
      // Determine escrow vault (for now use a known PDA or the request's escrow field)
      // In production this would be derived from the escrow vault seed
      const escrowVault = claim.pubkey; // Simplified — real impl uses escrow PDA

      const sig = await claimFee(
        this.connection,
        this.keypair,
        claim.pubkey,
        escrowVault,
        this.foundationPubkey,
        this.burnAddress
      );

      claim.claimed = true;
      log.info({ sig, request: claim.pubkey.toBase58() }, "Fee claimed successfully");
    } catch (err) {
      log.error({ err, request: claim.pubkey.toBase58() }, "Failed to claim fee");
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getStats() {
    return {
      lastNonce: this.lastProcessedNonce.toString(),
      pendingClaims: this.pendingClaims.filter((c) => !c.claimed).length,
      totalProcessed: this.pendingClaims.length,
    };
  }
}
