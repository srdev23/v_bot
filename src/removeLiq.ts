import assert from "assert";
import {
  jsonInfo2PoolKeys,
  Liquidity,
  LiquidityPoolKeys,
  TokenAmount,
  TOKEN_PROGRAM_ID,
  Token,
  LOOKUP_TABLE_CACHE,
  CacheLTA,
  InnerSimpleTransaction,
  InnerSimpleV0Transaction,
} from "@raydium-io/raydium-sdk";
import {
  Keypair,
  Signer,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
  TransactionInstruction,
  AddressLookupTableAccount,
  Blockhash,
} from "@solana/web3.js";
import {
  connection,
  JitoTipIxn,
  mainWallet,
  makeTxVersion,
} from "../config";
import { formatAmmKeysById } from "./services/formatAmmKeysById";
import { sendBundle } from "./services/jito.service";
import { checkTxnSize, FileService, retryAfter } from "./services/utils";
import { getSellBalance } from "./buy_sell";
import { getWalletTokenAccount } from "./services/raydiumUtil";
import chalk from "chalk";

// removeLiquidity();
export async function removeLiquidity() {
  try{

    console.log(chalk.blue("\n> Starting liquidity removal process...\n"));
    const dexInfo = await FileService.getInfo();
    const PoolId = dexInfo.PoolId;
    console.log(chalk.cyan({ PoolId }));
    const pooljsonInfo = await formatAmmKeysById(PoolId);
    assert(pooljsonInfo, "cannot find the target pool");
    const poolKeys = jsonInfo2PoolKeys(pooljsonInfo) as LiquidityPoolKeys;
    // const poolKeys = await derivePoolKeys(mainWallet, marketID);

    const bundledTxns: VersionedTransaction[] = [];
    const lpToken = new Token(
      TOKEN_PROGRAM_ID,
      new PublicKey(poolKeys.lpMint),
      poolKeys.baseDecimals
    );

    const lpTokenBal = await getSellBalance(mainWallet, poolKeys.lpMint, 1);
    if(lpTokenBal <= 0){
      console.log(chalk.yellow("No liquidity to remove."));
      process.exit(1);
    }
    console.log(chalk.cyan({ lpMint: poolKeys.lpMint.toString(), lpTokenBal: lpTokenBal.toString() }));
    const removeLpTokenAmount = new TokenAmount(lpToken, lpTokenBal);
    const walletTokenAccounts = await getWalletTokenAccount(
      connection,
      mainWallet.publicKey
    );

    const { innerTransactions } =
      await Liquidity.makeRemoveLiquidityInstructionSimple({
        connection,
        poolKeys,
        userKeys: {
          owner: mainWallet.publicKey,
          payer: mainWallet.publicKey,
          tokenAccounts: walletTokenAccounts,
        },
        amountIn: removeLpTokenAmount,
        makeTxVersion,
      });

    const { blockhash } = await connection.getLatestBlockhash("finalized");

    const willSendTx = await buildSimpleTransaction({
      wallet: mainWallet,
      innerTransactions: innerTransactions,
      recentBlockhash: blockhash,
      addLookupTableInfo: LOOKUP_TABLE_CACHE,
    });

    const messageV0 = new TransactionMessage({
      payerKey: mainWallet.publicKey,
      recentBlockhash: blockhash,
      instructions: [JitoTipIxn],
    }).compileToV0Message();
    console.log(chalk.green("Jito tip added :),"));
    
    const vTxn = new VersionedTransaction(messageV0);
    checkTxnSize(vTxn);
    vTxn.sign([mainWallet]);
    bundledTxns.push(...willSendTx, vTxn);

    await sendBundle(bundledTxns);
  }catch(e){
    console.error('Error removing LP...',e);
    await retryAfter();
    await removeLiquidity();
    // process.exit(1);
  }
}

async function buildSimpleTransaction({
  wallet,
  innerTransactions,
  recentBlockhash,
  addLookupTableInfo,
}: {
  wallet: Keypair;
  innerTransactions: InnerSimpleTransaction[];
  recentBlockhash: string | Blockhash;
  addLookupTableInfo?: CacheLTA | undefined;
}): Promise<VersionedTransaction[]> {
  const txList: VersionedTransaction[] = [];
  console.log("innerLen:", innerTransactions.length);
  for (const itemIx of innerTransactions) {
    txList.push(
      _makeTransaction({
        wallet,
        instructions: itemIx.instructions,
        recentBlockhash,
        signers: itemIx.signers,
        lookupTableInfos: Object.values({
          ...(addLookupTableInfo ?? {}),
          ...((itemIx as InnerSimpleV0Transaction).lookupTableAddress ?? {}),
        }),
      })
    );
  }
  return txList;
}

function _makeTransaction({
  wallet,
  instructions,
  recentBlockhash,
  signers,
  lookupTableInfos,
}: {
  wallet: Keypair;
  instructions: TransactionInstruction[];
  recentBlockhash: string | Blockhash;
  signers: (Signer | Keypair)[];
  lookupTableInfos?: AddressLookupTableAccount[];
}): VersionedTransaction {
  const messageV0 = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash,
    instructions,
  });
  const itemV = new VersionedTransaction(
    messageV0.compileToV0Message(lookupTableInfos)
  );
  itemV.sign(signers);
  itemV.sign([wallet]);
  return itemV;
}
