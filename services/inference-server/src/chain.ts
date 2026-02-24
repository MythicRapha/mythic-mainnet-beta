import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { serialize } from "borsh";
import { createHash } from "crypto";
import fs from "fs";
import pino from "pino";
import { CONFIG, SEEDS } from "./config";

const log = pino({ level: CONFIG.logLevel });

// ---------------------------------------------------------------
// Keypair loading
// ---------------------------------------------------------------

export function loadKeypair(): Keypair {
  const raw = fs.readFileSync(CONFIG.validatorKeypairPath, "utf-8");
  const secretKey = Uint8Array.from(JSON.parse(raw));
  return Keypair.fromSecretKey(secretKey);
}

// ---------------------------------------------------------------
// PDA derivation helpers
// ---------------------------------------------------------------

export function deriveConfigPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.aiConfig],
    CONFIG.aiProgramId
  );
}

export function deriveValidatorPDA(authority: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.aiValidator, authority.toBuffer()],
    CONFIG.aiProgramId
  );
}

export function deriveInferencePDA(nonce: bigint): [PublicKey, number] {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(nonce);
  return PublicKey.findProgramAddressSync(
    [SEEDS.inference, buf],
    CONFIG.aiProgramId
  );
}

export function deriveResultPDA(requestPubkey: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.result, requestPubkey.toBuffer()],
    CONFIG.aiProgramId
  );
}

// ---------------------------------------------------------------
// SHA-256 helper
// ---------------------------------------------------------------

export function sha256(data: Buffer): Buffer {
  return createHash("sha256").update(data).digest();
}

// ---------------------------------------------------------------
// Instruction builders
// ---------------------------------------------------------------

// Discriminator byte enum matching on-chain AiInstruction
const DISC = {
  Initialize: 0,
  RegisterModel: 1,
  RegisterValidator: 2,
  RequestInference: 3,
  SubmitResult: 4,
  VerifyLogits: 5,
  ClaimInferenceFee: 6,
  Pause: 7,
  Unpause: 8,
} as const;

/**
 * Register this server as an AI validator on-chain.
 * Transfers stake to the vault and creates the AIValidator PDA.
 */
export async function registerValidator(
  connection: Connection,
  payer: Keypair,
  stakeVault: PublicKey,
  supportedModelHashes: Buffer[]
): Promise<string> {
  const [configPDA] = deriveConfigPDA();
  const [validatorPDA] = deriveValidatorPDA(payer.publicKey);

  // Borsh-encode RegisterValidatorArgs
  const gpuModelBuf = Buffer.from(CONFIG.gpuModel, "utf-8");
  const stakeAmountBuf = Buffer.alloc(8);
  stakeAmountBuf.writeBigUInt64LE(CONFIG.stakeAmount);

  const vramBuf = Buffer.alloc(2);
  vramBuf.writeUInt16LE(CONFIG.vramGb);

  // Supported models vec: 4-byte len + items
  const modelsLenBuf = Buffer.alloc(4);
  modelsLenBuf.writeUInt32LE(supportedModelHashes.length);

  const modelsBuf = Buffer.concat([
    modelsLenBuf,
    ...supportedModelHashes.map((h) => {
      if (h.length !== 32) throw new Error("Model hash must be 32 bytes");
      return h;
    }),
  ]);

  // GPU model string: 4-byte len + data
  const gpuLenBuf = Buffer.alloc(4);
  gpuLenBuf.writeUInt32LE(gpuModelBuf.length);

  const data = Buffer.concat([
    Buffer.from([DISC.RegisterValidator]),
    stakeAmountBuf,
    gpuLenBuf,
    gpuModelBuf,
    vramBuf,
    modelsBuf,
  ]);

  const ix = new TransactionInstruction({
    programId: CONFIG.aiProgramId,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: validatorPDA, isSigner: false, isWritable: true },
      { pubkey: configPDA, isSigner: false, isWritable: false },
      { pubkey: stakeVault, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [payer]);
  log.info({ sig }, "Registered as AI validator on-chain");
  return sig;
}

/**
 * Submit inference result on-chain.
 */
export async function submitResult(
  connection: Connection,
  payer: Keypair,
  requestPubkey: PublicKey,
  validatorPDA: PublicKey,
  outputHash: Buffer,
  logitFingerprint: number[][],
  computeUnitsUsed: bigint
): Promise<string> {
  const [resultPDA] = deriveResultPDA(requestPubkey);

  // Encode SubmitResultArgs
  // output_hash: [u8; 32]
  // logit_fingerprint: Vec<[f32; 4]>
  // compute_units_used: u64

  // logit_fingerprint vec encoding
  const fpLenBuf = Buffer.alloc(4);
  fpLenBuf.writeUInt32LE(logitFingerprint.length);

  const fpBufs = logitFingerprint.map((arr) => {
    const b = Buffer.alloc(16); // 4 * f32
    for (let i = 0; i < 4; i++) {
      b.writeFloatLE(arr[i] || 0, i * 4);
    }
    return b;
  });

  const cuBuf = Buffer.alloc(8);
  cuBuf.writeBigUInt64LE(computeUnitsUsed);

  const data = Buffer.concat([
    Buffer.from([DISC.SubmitResult]),
    outputHash,
    fpLenBuf,
    ...fpBufs,
    cuBuf,
  ]);

  const ix = new TransactionInstruction({
    programId: CONFIG.aiProgramId,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: requestPubkey, isSigner: false, isWritable: true },
      { pubkey: resultPDA, isSigner: false, isWritable: true },
      { pubkey: validatorPDA, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [payer]);
  log.info({ sig, request: requestPubkey.toBase58() }, "Submitted inference result");
  return sig;
}

/**
 * Claim inference fee after challenge window.
 */
export async function claimFee(
  connection: Connection,
  payer: Keypair,
  requestPubkey: PublicKey,
  escrowVault: PublicKey,
  foundationPubkey: PublicKey,
  burnAddress: PublicKey
): Promise<string> {
  const [configPDA] = deriveConfigPDA();

  const data = Buffer.from([DISC.ClaimInferenceFee]);

  const ix = new TransactionInstruction({
    programId: CONFIG.aiProgramId,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: requestPubkey, isSigner: false, isWritable: true },
      { pubkey: escrowVault, isSigner: false, isWritable: true },
      { pubkey: configPDA, isSigner: false, isWritable: false },
      { pubkey: foundationPubkey, isSigner: false, isWritable: true },
      { pubkey: burnAddress, isSigner: false, isWritable: true },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [payer]);
  log.info({ sig, request: requestPubkey.toBase58() }, "Claimed inference fee");
  return sig;
}

// ---------------------------------------------------------------
// Event parsing (from program logs)
// ---------------------------------------------------------------

export interface InferenceRequestEvent {
  requester: string;
  nonce: number;
  maxFee: number;
  modelHash: string;
  requestPubkey: PublicKey;
}

export function parseInferenceEvent(
  logs: string[],
  nonce: bigint
): InferenceRequestEvent | null {
  for (const line of logs) {
    if (line.includes("EVENT:InferenceRequested:")) {
      try {
        const json = line.split("EVENT:InferenceRequested:")[1];
        const data = JSON.parse(json);
        const [requestPDA] = deriveInferencePDA(nonce);
        return {
          requester: data.requester,
          nonce: data.nonce,
          maxFee: data.max_fee,
          modelHash: data.model_hash,
          requestPubkey: requestPDA,
        };
      } catch {
        return null;
      }
    }
  }
  return null;
}
