import {
  Liquidity,
  SPL_ACCOUNT_LAYOUT,
  Token,
  TOKEN_PROGRAM_ID,
  TokenAccount,
} from '@raydium-io/raydium-sdk';
import {
  Connection,
  Keypair,
  PublicKey
} from '@solana/web3.js';

import { BN } from '@project-serum/anchor';
import { connection, feeId, makeTxVersion, OpenBookMarket, RayLiqPoolv4 } from '../../config';
 
type LiquidityPairTargetInfo = {
    baseToken: Token
    quoteToken: Token
    targetMarketId: PublicKey
}
type CalcStartPrice = {
    addBaseAmount: BN
    addQuoteAmount: BN
}
type WalletTokenAccounts = Awaited<ReturnType<typeof getWalletTokenAccount>>


type TestTxInputInfo = LiquidityPairTargetInfo &
  CalcStartPrice & {
    startTime: number // seconds
    walletTokenAccounts: WalletTokenAccounts
    wallet: Keypair
  }

export async function getWalletTokenAccount(connection: Connection, wallet: PublicKey): Promise<TokenAccount[]> {
  const walletTokenAccount = await connection.getTokenAccountsByOwner(wallet, {
    programId: TOKEN_PROGRAM_ID,
  });
  return walletTokenAccount.value.map((i) => ({
    pubkey: i.pubkey,
    programId: i.account.owner,
    accountInfo: SPL_ACCOUNT_LAYOUT.decode(i.account.data),
  }));
}

export async function ammCreatePool(input: TestTxInputInfo) {
  // -------- step 1: make instructions --------
  const initPoolInstructionResponse = await Liquidity.makeCreatePoolV4InstructionV2Simple({
    connection,
    programId: RayLiqPoolv4,
    marketInfo: {
      marketId: input.targetMarketId,
      programId: OpenBookMarket,
    },
    baseMintInfo: input.baseToken,
    quoteMintInfo: input.quoteToken,
    baseAmount: input.addBaseAmount,
    quoteAmount: input.addQuoteAmount,
    startTime: new BN(Math.floor(input.startTime)),
    ownerInfo: {
      feePayer: input.wallet.publicKey,
      wallet: input.wallet.publicKey,
      tokenAccounts: input.walletTokenAccounts,
      useSOLBalance: true,
    },
    associatedOnly: false,
    checkCreateATAOwner: true,
    makeTxVersion,
    feeDestinationId: feeId, // only mainnet use this
  })

  return { txs: initPoolInstructionResponse }
}