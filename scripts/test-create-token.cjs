// Minimal test: try CreateToken with different account layouts to debug
const { Connection, Keypair, PublicKey, SystemProgram, TransactionInstruction, Transaction, sendAndConfirmTransaction, SYSVAR_RENT_PUBKEY } = require('/mnt/data/mythic-cli/node_modules/@solana/web3.js');
const { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddress, getOrCreateAssociatedTokenAccount } = require('/mnt/data/mythic-cli/node_modules/@solana/spl-token');
const { readFileSync } = require('fs');

const connection = new Connection('http://localhost:8899', 'confirmed');
const deployerJson = JSON.parse(readFileSync('/mnt/data/mythic-l2/keys/deployer.json', 'utf8'));
const deployer = Keypair.fromSecretKey(new Uint8Array(deployerJson));

const LAUNCHPAD = new PublicKey('MythPad111111111111111111111111111111111111');
const FOUNDATION = new PublicKey('AnVqSYE3ArJX9ZCbiReFcNa2JdLyri3GGGt34j63hT9e');
const mythMint = new PublicKey(readFileSync('/mnt/data/mythic-l2/keys/myth-mint-address.txt', 'utf8').trim());

function serializeBorsh(fields) {
  const buffers = [];
  for (const [type, value] of fields) {
    if (type === 'u8') { const b = Buffer.alloc(1); b.writeUInt8(value, 0); buffers.push(b); }
    else if (type === 'u16') { const b = Buffer.alloc(2); b.writeUInt16LE(value, 0); buffers.push(b); }
    else if (type === 'u64') { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(value), 0); buffers.push(b); }
    else if (type === 'pubkey') { buffers.push(value.toBuffer()); }
    else if (type === 'string') {
      const strBytes = Buffer.from(value, 'utf8');
      const lenBuf = Buffer.alloc(4);
      lenBuf.writeUInt32LE(strBytes.length, 0);
      buffers.push(lenBuf); buffers.push(strBytes);
    }
    else if (type === 'option_bytes32') {
      if (value === null) { buffers.push(Buffer.from([0])); }
      else { buffers.push(Buffer.from([1])); buffers.push(Buffer.from(value)); }
    }
  }
  return Buffer.concat(buffers);
}

async function main() {
  console.log('Deployer:', deployer.publicKey.toBase58());
  console.log('MYTH Mint:', mythMint.toBase58());

  const [configPDA] = PublicKey.findProgramAddressSync([Buffer.from('launchpad_config')], LAUNCHPAD);
  
  // Read launch index
  const cfgData = await connection.getAccountInfo(configPDA);
  const launchIndex = cfgData.data.readBigUInt64LE(75);
  console.log('Launch index:', launchIndex.toString());
  const launchIndexBytes = Buffer.alloc(8);
  launchIndexBytes.writeBigUInt64LE(launchIndex);

  const [mintPDA] = PublicKey.findProgramAddressSync([Buffer.from('mint'), launchIndexBytes], LAUNCHPAD);
  const [launchPDA] = PublicKey.findProgramAddressSync([Buffer.from('token_launch'), mintPDA.toBuffer()], LAUNCHPAD);
  const [curveVaultPDA] = PublicKey.findProgramAddressSync([Buffer.from('curve_vault'), mintPDA.toBuffer()], LAUNCHPAD);
  const curveVaultAta = await getAssociatedTokenAddress(mythMint, curveVaultPDA, true);
  const creatorTokenAta = await getAssociatedTokenAddress(mintPDA, deployer.publicKey, true);

  const deployerMythAta = await getOrCreateAssociatedTokenAccount(connection, deployer, mythMint, deployer.publicKey);
  const foundationMythAta = await getOrCreateAssociatedTokenAccount(connection, deployer, mythMint, FOUNDATION);

  console.log('Mint PDA:', mintPDA.toBase58());
  console.log('Launch PDA:', launchPDA.toBase58());
  console.log('Curve Vault PDA:', curveVaultPDA.toBase58());
  console.log('Curve Vault ATA:', curveVaultAta.toBase58());

  const createData = Buffer.concat([
    Buffer.from([1]),
    serializeBorsh([
      ['string', 'TestToken'],
      ['string', 'TEST'],
      ['string', ''],
      ['string', 'A test token'],
      ['option_bytes32', null],
      ['u64', BigInt('1000')],
      ['u64', BigInt('1')],
      ['u64', BigInt('1000000000000')],
      ['u64', BigInt('0')],
    ]),
  ]);

  // Try: curve_vault = ATA, and also include the PDA as extra remaining account
  // The CPI for create_associated_token_account needs:
  // payer, ATA, wallet, mint, system, token, ata_program
  // So curve_vault should be the ATA (it's the one being created)
  // And the wallet (curveVaultPDA) needs to also be in the accounts
  
  // Actually, the CPI in the code passes:
  // [creator, curve_vault, mint_account, myth_mint, system, token, ata]
  // The create_associated_token_account instruction expects:
  // [funding, associated_token, wallet_address, token_mint, system, spl_token, ata_program]
  // 
  // So the code maps:
  // curve_vault -> associated_token (the ATA to be created)
  // mint_account -> wallet_address (WRONG - this is the new token mint, not vault_pda)
  //
  // This means the code has a bug: it passes mint_account (new token mint) where
  // it should pass vault_pda (the wallet). The ATA would be derived as:
  // ATA(mint=myth_mint, owner=mint_account) instead of ATA(mint=myth_mint, owner=vault_pda)
  
  // Let me try: set curve_vault = ATA(myth_mint, mintPDA) instead
  // Because the CPI actually does: create_ata(payer=creator, wallet=vault_pda, mint=myth_mint)
  // But passes mint_account as wallet in the accounts...
  
  // Actually, invoke doesn't care about account ordering in the account_info array.
  // The CPI instruction itself specifies which accounts map to which positions.
  // The [creator, curve_vault, mint_account, ...] array is just providing the
  // AccountInfo objects that the runtime will match by pubkey.
  
  // So the instruction is:
  //   create_ata(payer=creator.key, wallet=vault_pda, mint=myth_mint.key, token_program=spl_token::id())
  // This generates an instruction with these account metas:
  //   0: payer (signer, writable) = creator.key
  //   1: ATA (writable) = derived_ata(myth_mint, vault_pda)
  //   2: wallet (readonly) = vault_pda
  //   3: token mint (readonly) = myth_mint.key
  //   4: system program
  //   5: token program
  //   6: ata program (if v2)
  //
  // The runtime needs to find AccountInfo for each key in the instruction.
  // It looks them up from the invoke's account_info array BY PUBKEY.
  // So we need: creator, ATA(myth_mint, vault_pda), vault_pda, myth_mint
  // all to be present in the outer instruction's accounts.
  
  // vault_pda = curveVaultPDA
  // ATA(myth_mint, curveVaultPDA) = curveVaultAta
  // 
  // Our outer instruction accounts need to include BOTH curveVaultPDA and curveVaultAta
  // The program validates curve_vault.key == curveVaultPDA (account 4)
  // But the CPI needs curveVaultAta to be available too
  
  // So let me pass: account 4 = curveVaultPDA (passes validation)
  // And add curveVaultAta as an extra account somewhere in the list
  // The program doesn't read beyond account 12, but the runtime can find
  // the ATA account info from the full list

  console.log('\nTrying with PDA as account[4] and ATA as extra account[13]...');
  try {
    const ix = new TransactionInstruction({
      programId: LAUNCHPAD,
      keys: [
        { pubkey: deployer.publicKey, isSigner: true, isWritable: true },     // 0
        { pubkey: configPDA, isSigner: false, isWritable: true },              // 1
        { pubkey: launchPDA, isSigner: false, isWritable: true },              // 2
        { pubkey: mintPDA, isSigner: false, isWritable: true },                // 3
        { pubkey: curveVaultPDA, isSigner: false, isWritable: true },          // 4 = PDA (passes validation)
        { pubkey: mythMint, isSigner: false, isWritable: false },              // 5
        { pubkey: deployerMythAta.address, isSigner: false, isWritable: true },// 6
        { pubkey: creatorTokenAta, isSigner: false, isWritable: true },        // 7
        { pubkey: foundationMythAta.address, isSigner: false, isWritable: true },// 8
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },      // 9
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // 10
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },// 11
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },    // 12
        { pubkey: curveVaultAta, isSigner: false, isWritable: true },          // 13 = ATA (for CPI)
      ],
      data: createData,
    });
    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(connection, tx, [deployer], { commitment: 'confirmed' });
    console.log('SUCCESS:', sig);
  } catch (e) {
    console.log('FAILED:', (e.message || e.toString()).substring(0, 800));
    
    // Try the logs
    if (e.logs) {
      console.log('\nLogs:');
      e.logs.forEach(l => console.log('  ', l));
    }
  }
}

main().catch(e => console.error('Fatal:', e));
