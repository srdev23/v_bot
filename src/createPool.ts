import {
  connection,
  Delay_t,
  JitoTipIxn,
  mainWallet,
  RayLiqPoolv4,
  Sol2pool,
  wSolToken,
} from "../config";
import {
  PublicKey,
  VersionedTransaction,
  TransactionInstruction,
  TransactionMessage,
  Keypair,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getMint } from "@solana/spl-token";
import {
  Liquidity,
  MARKET_STATE_LAYOUT_V3,
  Token,
  MAINNET_PROGRAM_ID,
} from "@raydium-io/raydium-sdk";
import { BN } from "@project-serum/anchor";
import { ammCreatePool, getWalletTokenAccount } from "./services/raydiumUtil";
import { sendBundle } from "./services/jito.service";
import { checkTxnSize, FileService, retryAfter } from "./services/utils";
import chalk from "chalk";

type LiquidityPairTargetInfo = {
  baseToken: Token;
  quoteToken: Token;
  targetMarketId: PublicKey;
};

// createPool();

export async function createPool() {
  try{
    console.log(chalk.blue("\n> Starting creat & init new pool process...\n"));

    const dexInfo = await FileService.getInfo();
    // const mint = dexInfo.Mint;
    const mint = "FcjUfYMD1QJNRtA5zjyNxoUXXjJfUJBeTFPF8bzcAtqP";
    console.log({mint});
    const myToken = new PublicKey(mint);
    console.log("Creating new pool...");
    const tokenInfo = {
      address: myToken,
      decimals: 6,
      mintAuthority: null,
      supply: new BN(0),
      isInitialized: true,
      freezeAuthority: null,
    };

    // const solBal = (await connection.getBalance(mainWallet.publicKey)) / LAMPORTS_PER_SOL;
    // const solRequired = Sol2pool / LAMPORTS_PER_SOL + 0.4;
    // if(solBal < solRequired) {
    //   console.log(chalk.red(`Insufficient SOL balance: ${solBal}/ ${solRequired} SOL`));
    //   process.exit(1);
    // }

    // Fetch balance of token
    // const tokenBalance = await fetchTokenBalance(
    //   mainWallet,
    //   mint,
    //   tokenInfo.decimals
    // );

    
    // console.log(chalk.cyan({tokenBalance, Sol2pool}));
    const baseToken = new Token(TOKEN_PROGRAM_ID, myToken, tokenInfo.decimals); // Token to put into pool
    const quoteToken = wSolToken; // SOL s quote
    const marketid = dexInfo.MarketId;
    console.log({marketid});
    const targetMarketId = new PublicKey(marketid); // Convert to pubkey
    // -------- step 2: create pool txn --------
    const walletTokenAccounts = await getWalletTokenAccount(
      connection,
      mainWallet.publicKey
    );

    // const marketBufferInfo: any = await connection.getAccountInfo(targetMarketId);
    // const {
    //   baseMint,
    //   quoteMint,
    //   baseLotSize,
    //   quoteLotSize,
    //   baseVault,
    //   quoteVault,
    //   bids,
    //   asks,
    //   eventQueue,
    //   requestQueue,
    // } = MARKET_STATE_LAYOUT_V3.decode(marketBufferInfo.data);

    // let poolKeys: any = Liquidity.getAssociatedPoolKeys({
    //   version: 4,
    //   marketVersion: 3,
    //   baseMint,
    //   quoteMint,
    //   baseDecimals: tokenInfo.decimals,
    //   quoteDecimals: 9,
    //   marketId: targetMarketId,
    //   programId: RayLiqPoolv4,
    //   marketProgramId: MAINNET_PROGRAM_ID.OPENBOOK_MARKET,
    // });
    // poolKeys.marketBaseVault = baseVault;
    // poolKeys.marketQuoteVault = quoteVault;
    // poolKeys.marketBids = bids;
    // poolKeys.marketAsks = asks;
    // poolKeys.marketEventQueue = eventQueue;

    // const baseMintAmount = new BN(tokenBalance.toString());
    const baseMintAmount = new BN((1000_000).toString());
    const quoteMintAmount = new BN(Sol2pool.toString());

    const addBaseAmount = new BN(baseMintAmount.toString());
    const addQuoteAmount = new BN(quoteMintAmount.toString());
    const startTime = Math.floor(Date.now() / 1000);

    const bundledTxns: VersionedTransaction[] = [];

    console.log("ammcreatepool")
    const { txs } = await ammCreatePool({
      startTime,
      addBaseAmount,
      addQuoteAmount,
      baseToken,
      quoteToken,
      targetMarketId,
      wallet: mainWallet,
      walletTokenAccounts,
    });

    console.log("Create pool txns created");
    const createPoolInstructions: TransactionInstruction[] = [];
    for (const itemIx of txs.innerTransactions) {
      createPoolInstructions.push(...itemIx.instructions);
    }
    createPoolInstructions.push(JitoTipIxn);
    console.log(chalk.green("Jito tip added :),"));

    const { blockhash } = await connection.getLatestBlockhash("finalized");

    const messageV0 = new TransactionMessage({
      payerKey: mainWallet.publicKey,
      recentBlockhash: blockhash,
      instructions: createPoolInstructions,
    }).compileToV0Message();

    const vTxn = new VersionedTransaction(messageV0);
    checkTxnSize(vTxn);
    vTxn.sign([mainWallet]);
    bundledTxns.push(vTxn);

    await sendBundle(bundledTxns, false);
    // Fetch Pool info and write to json
    const associatedPoolKeys = getMarketAssociatedPoolKeys({
      baseToken,
      quoteToken,
      targetMarketId,
    });
    console.log(chalk.green("pool id", associatedPoolKeys.id));
    FileService.savePoolInfo(associatedPoolKeys);
   
  }catch(e){
    console.error('Error creating new pool', e);
    await retryAfter();
    await createPool();
    // process.exit(1);
  }
}

async function fetchTokenBalance(
  wallet: Keypair,
  TokenPubKey: string,
  decimalsToken: number
) {
  const ownerPubKey = wallet.publicKey;

  const response = await connection.getParsedTokenAccountsByOwner(ownerPubKey, {
    mint: new PublicKey(TokenPubKey),
  });

  let tokenBalance = 0;
  for (const account of response.value) {
    const amount = account.account.data.parsed.info.tokenAmount.uiAmount;
    tokenBalance += amount;
  }

  return tokenBalance * 10 ** decimalsToken;
}

function getMarketAssociatedPoolKeys(input: LiquidityPairTargetInfo) {
  const poolInfo = Liquidity.getAssociatedPoolKeys({
    version: 4,
    marketVersion: 3,
    baseMint: input.baseToken.mint,
    quoteMint: input.quoteToken.mint,
    baseDecimals: input.baseToken.decimals,
    quoteDecimals: input.quoteToken.decimals,
    marketId: input.targetMarketId,
    programId: RayLiqPoolv4,
    marketProgramId: MAINNET_PROGRAM_ID.OPENBOOK_MARKET,
  });
  return poolInfo;
}
