import {
  connection,
  JitoTipIxn,
  mainWallet,
} from "../config";
import {
  PublicKey,
  VersionedTransaction,
  TransactionInstruction,
  TransactionMessage,
} from "@solana/web3.js";

import { BN } from "@project-serum/anchor";
import { sendBundle } from "./services/jito.service";
import * as spl from "@solana/spl-token";
import { derivePoolKeys } from "./services/poolKeysReassigned";
import { checkTxnSize, FileService, retryAfter } from "./services/utils";
import { getSellBalance, makeSwap } from "./buy_sell";
import chalk from "chalk";

// buy_sell()
export async function sellAlltoken() {
  try {
    console.log(chalk.blue("\n> Starting sell all token process...\n"));
    const dexInfo = await FileService.getInfo();
    const lut = new PublicKey(dexInfo.LUT);
    const lookupTableAccount = (await connection.getAddressLookupTable(lut))
      .value;

    if (lookupTableAccount == null) {
      console.error("Lookup table account not found!");
      process.exit(1);
    }

    const marketID = new PublicKey(dexInfo.MarketId);

    const poolKeys = await derivePoolKeys(mainWallet, marketID);
    if (poolKeys == null) {
      console.error("Error fetching poolkeys");
      process.exit(1);
    }

    const { blockhash } = await connection.getLatestBlockhash("finalized");
    // Iterate over each chunk of keypairs
    const instructionsForChunk: TransactionInstruction[] = [];
    // Iterate over each keypair in the chunk to create swap instructions

    const tokenATA = await spl.getAssociatedTokenAddress(
      poolKeys.baseMint,
      mainWallet.publicKey
    );

    const wSolATA = await spl.getAssociatedTokenAddress(
      spl.NATIVE_MINT,
      mainWallet.publicKey
    );

    const transferAmount = await getSellBalance(
      mainWallet,
      poolKeys.baseMint,
      1
    );
    console.log(
      chalk.green(
        mainWallet.publicKey.toString(),
        "Total amount:",
        transferAmount
      )
    );

    if(transferAmount <= 0){
      console.error('Insufficient balance');
      process.exit(1);
    }

    const { sellIxs } = makeSwap(
      false,
      poolKeys,
      wSolATA,
      tokenATA,
      mainWallet,
      new BN(transferAmount),
      new BN(0)
    ); //  SELL TXN

    const createWsolIxs = spl.createAssociatedTokenAccountIdempotentInstruction(
      mainWallet.publicKey,
      wSolATA,
      mainWallet.publicKey,
      spl.NATIVE_MINT
    );

    const closeWsolIxs = spl.createCloseAccountInstruction(
      wSolATA, // WSOL account to close
      mainWallet.publicKey, // Destination for remaining SOL
      mainWallet.publicKey // Owner of the WSOL account, may need to be the wallet if it's the owner
    );
    const closeTokenIxs = spl.createCloseAccountInstruction(
      tokenATA, // WSOL account to close
      mainWallet.publicKey, // Destination for remaining token
      mainWallet.publicKey // Owner of the WSOL account, may need to be the wallet if it's the owner
    );

    instructionsForChunk.push(
      createWsolIxs,
      ...sellIxs,
      // closeWsolIxs,
      // closeTokenIxs,
      JitoTipIxn
    );

    const messageV0 = new TransactionMessage({
      payerKey: mainWallet.publicKey,
      recentBlockhash: blockhash,
      instructions: instructionsForChunk,
    }).compileToV0Message([lookupTableAccount]);

    const vTxn = new VersionedTransaction(messageV0);
    vTxn.sign([mainWallet]);
    const bundledTxns: VersionedTransaction[] = [];
    bundledTxns.push(vTxn);
    checkTxnSize(vTxn);
    await sendBundle(bundledTxns);
  } catch (e) {
    console.error("Error selling all token...", e);
    await retryAfter();
    await sellAlltoken();
    // process.exit(1);
  }
}