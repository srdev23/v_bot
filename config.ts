import {
  MAINNET_PROGRAM_ID,
  Token,
  TOKEN_PROGRAM_ID,
  TxVersion,
} from "@raydium-io/raydium-sdk";
import { NATIVE_MINT } from "@solana/spl-token";
import { SystemProgram } from "@solana/web3.js";
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Connection, PublicKey } from "@solana/web3.js";
import base58 from "bs58";
import "dotenv/config";

export const RPC_URL = process.env.RPC_URL || "";
export const WSS_URL = process.env.WSS_URL || "";
export const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
export const connection = new Connection(RPC_URL, { wsEndpoint: WSS_URL });

export const mainWallet = Keypair.fromSecretKey(
  Uint8Array.from(base58.decode(PRIVATE_KEY))
);
export const feeId = new PublicKey(
  "7YttLkHDoNj9wyDur5pM1ejNaAvT9X4eqaYcHQqtj2G5"
);
export const TipAcc = new PublicKey(
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY"
);

export const wSolToken = new Token(
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  9
);

export const makeTxVersion = TxVersion.V0;
export const RayLiqPoolv4 = MAINNET_PROGRAM_ID.AmmV4;
export const OpenBookMarket = MAINNET_PROGRAM_ID.OPENBOOK_MARKET;

//------------------------------ User Setting( Please set your configurations ) ------------------------------//

export const Sol2pool = 3 * LAMPORTS_PER_SOL; // Sol amount for pool initialization
export const DisAmnt_min = 0.000001 * LAMPORTS_PER_SOL; // Min sol amount to sub-wallet
export const DisAmnt_max = 0.00001 * LAMPORTS_PER_SOL; // Max sol amount to sub-wallet
export const JitoTip = 0.0001 * LAMPORTS_PER_SOL; // Jitp tip amount
export const Profit_x = 30; // (30% profit of investamount)
export const Mint_add = 500_000_000; // Additional token supply
export const MaxIteration = 1000000000; // Maximum number of iterations for volumne bot

export const Delay_t = 1000 * 10; // Delay time between each volume tranasction 
export const Wallets_num = 24; // Wallet total number

//-------------------------------------------------------------------------------------------------------------//

export const JitoTipIxn = SystemProgram.transfer({
  fromPubkey: mainWallet.publicKey,
  toPubkey: TipAcc,
  lamports: BigInt(JitoTip),
});