import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  VersionedTransaction,
  LAMPORTS_PER_SOL,
  TransactionMessage,
} from "@solana/web3.js";
import {
  connection,
  DisAmnt_max,
  DisAmnt_min,
  JitoTipIxn,
  mainWallet,
} from "../config";
import * as spl from "@solana/spl-token";
import base58 from "bs58";
import { sendBundle } from "./services/jito.service";
import {
  checkTxnSize,
  FileService,
  retryAfter,
  sleepTime,
} from "./services/utils";
import chalk from "chalk";
import { chunkArray } from "@raydium-io/raydium-sdk";

// distributeWSOL();
export async function distributeWSOL() {
  try {
    console.log(chalk.blue("\n> Distributing wsol...\n"));

    const dexInfo = await FileService.getInfo();
    const lut = new PublicKey(dexInfo.LUT);
    const pk_array = dexInfo.Wallets;
    const mint = dexInfo.Mint;

    const distributeAmount =
      Math.floor(Math.random() * (DisAmnt_max - DisAmnt_min)) + DisAmnt_min;

    const totalSolRequired: number =
      (distributeAmount * pk_array.length) / LAMPORTS_PER_SOL;
    console.log(
      chalk.green(`Distributing ${totalSolRequired.toFixed(9)} SOL...`)
    );

    const solBal =
      (await connection.getBalance(mainWallet.publicKey)) / LAMPORTS_PER_SOL;
    if (solBal < totalSolRequired) {
      console.log(chalk.red(`Insufficient SOL balance: ${solBal} SOL`));
      process.exit(1);
    }
    const { blockhash } = await connection.getLatestBlockhash();
    const getLutTableAcc = async (lut: PublicKey) => {
      const lutAcc = (await connection.getAddressLookupTable(lut)).value;
      if (lutAcc == null) {
        await sleepTime(3000);
        return await getLutTableAcc(lut);
      }
      return lutAcc;
    };
    const lookupTableAccount = await getLutTableAcc(lut);

    const bundledTxns: VersionedTransaction[] = [];
    const chunkedKeypairs = chunkArray(pk_array, 5);
    for (
      let chunkIndex = 0;
      chunkIndex < chunkedKeypairs.length;
      chunkIndex++
    ) {
      const chunk = chunkedKeypairs[chunkIndex];
      const instructionsForChunk: TransactionInstruction[] = [];
      const chunkWallet: Keypair[] = chunk.map((pk) =>
        Keypair.fromSecretKey(base58.decode(pk))
      );

      for (const keypair of chunkWallet) {
        const wsolAta = await spl.getAssociatedTokenAddress(
          spl.NATIVE_MINT,
          keypair.publicKey
        );

        const tokenAta = await spl.getAssociatedTokenAddress(
          new PublicKey(mint),
          keypair.publicKey
        );

        instructionsForChunk.push(
          spl.(
            mainWallet.publicKey,
            wsolAta,
            keypair.publicKey,
          spl.createAssociatedTokenAccountIdempotentInstruction(
            mainWallet.publicKey,
            tokenAta,
            keypair.publicKey,
            new PublicKey(mint)
          ),
          // SystemProgram.transfer({
          //   fromPubkey: mainWallet.publicKey,
          //   toPubkey: keypair.publicKey,
          //   lamports: 1000000,
          // }),
          SystemProgram.transfer({
            fromPubkey: mainWallet.publicKey,
            toPubkey: wsolAta,
            lamports: distributeAmount,
          }),
          spl.createSyncNativeInstruction(wsolAta)
        );
      }

      if (chunkIndex === chunkedKeypairs.length - 1) {
        instructionsForChunk.push(JitoTipIxn);
        console.log(chalk.green("Jito tip added :),"));
      }

      const messageV0 = new TransactionMessage({
        payerKey: mainWallet.publicKey,
        recentBlockhash: blockhash,
        instructions: instructionsForChunk,
      }).compileToV0Message([lookupTableAccount]);

      const vTxn = new VersionedTransaction(messageV0);
      vTxn.sign([mainWallet]);
      bundledTxns.push(vTxn);
      checkTxnSize(vTxn);
    }
    await sendBundle(bundledTxns);
  } catch (e) {
    console.error("Error distributing SOL", e);
    await retryAfter();
    await distributeWSOL();
    // process.exit(1);
  }
}