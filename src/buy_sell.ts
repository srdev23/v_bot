import {
  connection,
  Delay_t,
  JitoTipIxn,
  mainWallet,
  RayLiqPoolv4,
  wSolToken,
} from "../config";
import {
  PublicKey,
  VersionedTransaction,
  TransactionInstruction,
  TransactionMessage,
  Keypair,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getMint } from "@solana/spl-token";
import {
  Liquidity,
  Token,
  Percent,
  TokenAmount,
} from "@raydium-io/raydium-sdk";
import { BN } from "@project-serum/anchor";
import { sendBundle } from "./services/jito.service";
import * as spl from "@solana/spl-token";
import { IPoolKeys } from "./services/interfaces";
import { derivePoolKeys } from "./services/poolKeysReassigned";
import base58 from "bs58";
import { checkTxnSize, chunkArray, FileService, retryAfter, sleepTime } from "./services/utils";
import chalk from "chalk";

// buy_sell()
export async function buy_sell() {
  try{
    console.log(chalk.blue("\n> Starting buy & sell process...\n"));
    const dexInfo = await FileService.getInfo();
    const lut = new PublicKey(dexInfo.LUT);
    const lookupTableAccount = (await connection.getAddressLookupTable(lut))
      .value;

    if (lookupTableAccount == null) {
      console.error("Lookup table account not found!");
      process.exit(1);
    }

    const pk_array: string[] = dexInfo.Wallets;
    const marketID = new PublicKey(dexInfo.MarketId);

    const poolKeys = await derivePoolKeys(mainWallet, marketID);
    if (poolKeys == null) {
      console.error("Error fetching poolkeys");
      process.exit(1);
    }
    const poolInfo = await Liquidity.fetchInfo({ connection, poolKeys });
    const mintToken = new Token(
      TOKEN_PROGRAM_ID,
      poolKeys.baseMint,
      poolKeys.baseDecimals
    );
    const slippage = new Percent(100, 100);

    const bundledTxns: VersionedTransaction[] = [];
    const { blockhash } = await connection.getLatestBlockhash("finalized");
    // Iterate over each chunk of keypairs
    const chunkedKeypairs = chunkArray(pk_array, 5); // EDIT CHUNKS?
    for (let chunkIndex = 0; chunkIndex < chunkedKeypairs.length; chunkIndex++) {
      const chunk = chunkedKeypairs[chunkIndex];
      const instructionsForChunk: TransactionInstruction[] = [];
      const chunkWallet: Keypair[] = chunk.map((pk) =>
        Keypair.fromSecretKey(base58.decode(pk))
      );
      // Iterate over each keypair in the chunk to create swap instructions
      for (const keypair of chunkWallet) {

        const tokenATA = await spl.getAssociatedTokenAddress(
          poolKeys.baseMint,
          keypair.publicKey
        );

        const wSolATA = await spl.getAssociatedTokenAddress(
          spl.NATIVE_MINT,
          keypair.publicKey
        );

        const transferAmount = await getSellBalance(
          keypair,
          spl.NATIVE_MINT,
          0.9
        );

        if(transferAmount <= 0){
          console.error("nsufficient balance", transferAmount);
          continue;
        }
        // console.log(chalk.green(
        //   `Processing keypair ${i + 1}/${chunk.length}:`,
        //   keypair.publicKey.toString(),
        //   "Transfer amount:",
        //   transferAmount.toString())
        // );

        const wSolAmount = new TokenAmount(wSolToken, transferAmount);
        const { amountOut, minAmountOut } = Liquidity.computeAmountOut({
          poolKeys,
          poolInfo,
          amountIn: wSolAmount,
          currencyOut: mintToken,
          slippage,
        });

        const { amountIn, maxAmountIn } = Liquidity.computeAmountIn({
          poolKeys,
          poolInfo,
          amountOut,
          currencyIn: wSolToken,
          slippage,
        });

        const { buyIxs } = makeSwap(
          true,
          poolKeys,
          wSolATA,
          tokenATA,
          keypair,
          maxAmountIn.raw,
          amountOut.raw
        ); // BUY TXN

        const { sellIxs } = makeSwap(
          false,
          poolKeys,
          wSolATA,
          tokenATA,
          keypair,
          amountOut.raw,
          new BN(0)
        ); //  SELL TXN

        const closeWsolIxs = spl.createCloseAccountInstruction(
          wSolATA, // WSOL account to close
          mainWallet.publicKey, // Destination for remaining SOL
          keypair.publicKey // Owner of the WSOL account, may need to be the wallet if it's the owner
        );
        
        const closeTokenIxs = spl.createCloseAccountInstruction(
          tokenATA, // WSOL account to close
          mainWallet.publicKey, // Destination for remaining token
          keypair.publicKey // Owner of the WSOL account, may need to be the wallet if it's the owner
        );

        instructionsForChunk.push(
          ...buyIxs,
          ...sellIxs,
          closeWsolIxs,
          closeTokenIxs
        );
      }

      if (chunkIndex === chunkedKeypairs.length - 1) {
        instructionsForChunk.push(JitoTipIxn);
        console.log(chalk.green("Jito tip added :),"));
        // chunkWallet.push(mainWallet);
      }

      const messageV0 = new TransactionMessage({
        payerKey: mainWallet.publicKey,
        recentBlockhash: blockhash,
        instructions: instructionsForChunk,
      }).compileToV0Message([lookupTableAccount]);

      const vTxn = new VersionedTransaction(messageV0);
      vTxn.sign([...chunkWallet, mainWallet]);
      bundledTxns.push(vTxn);
      checkTxnSize(vTxn)
    }

    await sendBundle(bundledTxns);
  }catch(e){
    console.error('Error buy & selling token...', e);
    await retryAfter();
    await buy_sell();
    // process.exit(1);
  }
}

export async function getSellBalance(
  keypair: Keypair,
  mint: PublicKey,
  supplyPercent: number
): Promise<number> {
  try {
    const tokenAccountPubKey = spl.getAssociatedTokenAddressSync(
      mint,
      keypair.publicKey
    );
    const balance = await connection.getTokenAccountBalance(tokenAccountPubKey);
    return Math.floor(Number(balance.value.amount) * supplyPercent);
  } catch (e) {
    // console.error('Error getting balance');
    await sleepTime(3000);
    return await getSellBalance(keypair, mint, supplyPercent);
  }
}

export function makeSwap(
  isBuy: boolean,
  poolKeys: IPoolKeys,
  wSolATA: PublicKey,
  TokenATA: PublicKey,
  keypair: Keypair,
  inAmount: BN,
  outAmount: BN
) {
  const account1 = spl.TOKEN_PROGRAM_ID; // token program
  const account2 = poolKeys.id; // amm id  writable
  const account3 = poolKeys.authority; // amm authority
  const account4 = poolKeys.openOrders; // amm open orders  writable
  const account5 = poolKeys.targetOrders; // amm target orders  writable
  const account6 = poolKeys.baseVault; // pool coin token account  writable  AKA baseVault
  const account7 = poolKeys.quoteVault; // pool pc token account  writable   AKA quoteVault
  const account8 = poolKeys.marketProgramId; // serum program id
  const account9 = poolKeys.marketId; //   serum market  writable
  const account10 = poolKeys.marketBids; // serum bids  writable
  const account11 = poolKeys.marketAsks; // serum asks  writable
  const account12 = poolKeys.marketEventQueue; // serum event queue  writable
  const account13 = poolKeys.marketBaseVault; // serum coin vault  writable     AKA marketBaseVault
  const account14 = poolKeys.marketQuoteVault; //   serum pc vault  writable    AKA marketQuoteVault
  const account15 = poolKeys.marketAuthority; // serum vault signer       AKA marketAuthority
  let account16 = TokenATA; // user source token account  writable
  let account17 = wSolATA; // user dest token account   writable
  const account18 = keypair.publicKey; // user owner (signer)  writable
  if (isBuy) {
    account16 = wSolATA;
    account17 = TokenATA;
  }

  const buyArgs = {
    maxAmountIn: inAmount,
    amountOut: outAmount,
  };

  const sellArgs = {
    amountIn: inAmount,
    minimumAmountOut: outAmount,
  };

  let prefix;
  const buffer = Buffer.alloc(16);
  if (isBuy) {
    buyArgs.maxAmountIn.toArrayLike(Buffer, "le", 8).copy(buffer, 0);
    buyArgs.amountOut.toArrayLike(Buffer, "le", 8).copy(buffer, 8);
    prefix = Buffer.from([0xb]);
  } else {
    sellArgs.amountIn.toArrayLike(Buffer, "le", 8).copy(buffer, 0);
    sellArgs.minimumAmountOut.toArrayLike(Buffer, "le", 8).copy(buffer, 8);
    prefix = Buffer.from([0x09]);
  }
  const instructionData = Buffer.concat([prefix, buffer]);

  // console.log({ instructionData })
  const accountMetas = [
    { pubkey: account1, isSigner: false, isWritable: false },
    { pubkey: account2, isSigner: false, isWritable: true },
    { pubkey: account3, isSigner: false, isWritable: false },
    { pubkey: account4, isSigner: false, isWritable: true },
    { pubkey: account5, isSigner: false, isWritable: true },
    { pubkey: account6, isSigner: false, isWritable: true },
    { pubkey: account7, isSigner: false, isWritable: true },
    { pubkey: account8, isSigner: false, isWritable: false },
    { pubkey: account9, isSigner: false, isWritable: true },
    { pubkey: account10, isSigner: false, isWritable: true },
    { pubkey: account11, isSigner: false, isWritable: true },
    { pubkey: account12, isSigner: false, isWritable: true },
    { pubkey: account13, isSigner: false, isWritable: true },
    { pubkey: account14, isSigner: false, isWritable: true },
    { pubkey: account15, isSigner: false, isWritable: false },
    { pubkey: account16, isSigner: false, isWritable: true },
    { pubkey: account17, isSigner: false, isWritable: true },
    { pubkey: account18, isSigner: true, isWritable: true },
  ];

  const swap = new TransactionInstruction({
    keys: accountMetas,
    programId: RayLiqPoolv4,
    data: instructionData,
  });

  let buyIxs: TransactionInstruction[] = [];
  let sellIxs: TransactionInstruction[] = [];

  if (isBuy) buyIxs.push(swap);
  else sellIxs.push(swap);
  return { buyIxs, sellIxs };
}
