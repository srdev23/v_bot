import {
  AddressLookupTableProgram,
  Keypair,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  connection,
  JitoTipIxn,
  mainWallet,
  RayLiqPoolv4,
} from "../config";
import { derivePoolKeys } from "./services/poolKeysReassigned";
import * as spl from "@solana/spl-token";
import base58 from "bs58";
import { sendBundle } from "./services/jito.service";
import { checkTxnSize, FileService, retryAfter } from "./services/utils";
import chalk from "chalk";

// createLUT();
// extendLUT();

export async function createLUT() {
  try{
    console.log(chalk.blue('- Creating new lookup table...'));
    const bundledTxns: VersionedTransaction[] = [];
    const createLUTixs: TransactionInstruction[] = [];
    const [createTi, lut] = AddressLookupTableProgram.createLookupTable({
      authority: mainWallet.publicKey,
      payer: mainWallet.publicKey,
      recentSlot: await connection.getSlot("finalized"),
    });

    createLUTixs.push(createTi, JitoTipIxn);
    console.log(chalk.green("Jito tip added :),"));
    const { blockhash } = await connection.getLatestBlockhash();
    
    const messageV0 = new TransactionMessage({
      payerKey: mainWallet.publicKey,
      recentBlockhash: blockhash,
      instructions: createLUTixs,
    }).compileToV0Message();
    const vTxn = new VersionedTransaction(messageV0);
    checkTxnSize(vTxn);
    vTxn.sign([mainWallet]);
    bundledTxns.push(vTxn);

    await sendBundle(bundledTxns);
    FileService.saveLUT(lut);

  }catch(e){
    console.error('Error creating LUT', e);
    await retryAfter();
    await createLUT();
    // process.exit(1);
  }
}

export async function extendLUT() {
  try{
    console.log(chalk.blue('\n- Extending lookup table...'));

    const dexInfo = await FileService.getInfo();
    const lut = new PublicKey(dexInfo.LUT);
    const marketId = new PublicKey(dexInfo.MarketId);
    const pk_array = dexInfo.Wallets;

    const accounts: PublicKey[] = []; // Array with all new keys to push to the new LUT
    // Get market keys
    const poolKeys = await derivePoolKeys(mainWallet, marketId);
    if (poolKeys == null) {
      console.error("Poolkeys not found!");
      process.exit(1);
    }

    // These values vary based on the new market created
    accounts.push(
      lut,
      RayLiqPoolv4,
      spl.NATIVE_MINT,
      spl.TOKEN_PROGRAM_ID, // token program
      poolKeys.id, // amm id  writable
      poolKeys.authority, // amm authority
      poolKeys.openOrders, // amm open orders  writable
      poolKeys.targetOrders, // amm target orders  writable
      poolKeys.baseMint,
      poolKeys.quoteMint,
      poolKeys.baseVault, // pool coin token account  writable  AKA baseVault
      poolKeys.quoteVault, // pool pc token account  writable   AKA quoteVault
      poolKeys.marketProgramId, // serum program id
      poolKeys.marketId, //   serum market  writable
      poolKeys.marketBids, // serum bids  writable
      poolKeys.marketAsks, // serum asks  writable
      poolKeys.marketEventQueue, // serum event queue  writable
      poolKeys.marketBaseVault, // serum coin vault  writable     AKA marketBaseVault
      poolKeys.marketQuoteVault, //   serum pc vault  writable    AKA marketQuoteVault
      poolKeys.marketAuthority, // serum vault signer       AKA marketAuthority
      poolKeys.ownerQuoteAta, // user source token account  writable
      poolKeys.ownerBaseAta // user dest token account   writable
    );

    // Loop through each keypair and push its pubkey and ATAs to the accounts array
    for (const pk of pk_array) {
      const keypair = Keypair.fromSecretKey(base58.decode(pk));
      const ataToken = await spl.getAssociatedTokenAddress(
        new PublicKey(poolKeys.baseMint),
        keypair.publicKey
      );
      const ataWSOL = await spl.getAssociatedTokenAddress(
        spl.NATIVE_MINT,
        keypair.publicKey
      );
      accounts.push(keypair.publicKey, ataToken, ataWSOL);
    }

    const ataTokenpayer = await spl.getAssociatedTokenAddress(
      new PublicKey(poolKeys.baseMint),
      mainWallet.publicKey
    );
    const ataWSOLpayer = await spl.getAssociatedTokenAddress(
      spl.NATIVE_MINT,
      mainWallet.publicKey
    );

    // Add just in case
    accounts.push(mainWallet.publicKey, ataTokenpayer, ataWSOLpayer); // DO NOT ADD PROGRAM OR JITO TIP ACCOUNT
    const bundledTxns: VersionedTransaction[] = [];
    // Chunk accounts array into groups of 30
    const accountChunks = Array.from(
      { length: Math.ceil(accounts.length / 30) },
      (v, i) => accounts.slice(i * 30, (i + 1) * 30)
    );

    const { blockhash } = await connection.getLatestBlockhash();

    for (let i = 0; i < accountChunks.length; i++) {
      const chunk = accountChunks[i];
      const extendLUTixs: TransactionInstruction[] = [];
      const extendIx = AddressLookupTableProgram.extendLookupTable({
        lookupTable: lut,
        authority: mainWallet.publicKey,
        payer: mainWallet.publicKey,
        addresses: chunk,
      });

      extendLUTixs.push(extendIx);
      if (i === accountChunks.length - 1) {
        extendLUTixs.push(JitoTipIxn);
      }

      const messageV0 = new TransactionMessage({
        payerKey: mainWallet.publicKey,
        recentBlockhash: blockhash,
        instructions: extendLUTixs,
      }).compileToV0Message();

      const vTxn = new VersionedTransaction(messageV0);
      checkTxnSize(vTxn);
      vTxn.sign([mainWallet]);
      bundledTxns.push(vTxn);
    }
    // Send bundle
    await sendBundle(bundledTxns);
  }catch(e){
    console.error('Error extending LUT', e);
    await retryAfter();
    await extendLUT();
    // process.exit(1);
  }
}
