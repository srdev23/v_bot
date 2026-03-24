import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { FileService } from "./services/utils";
import { derivePoolKeys } from "./services/poolKeysReassigned";
import { connection, mainWallet, Sol2pool } from "../config";
import { Liquidity } from "@raydium-io/raydium-sdk";
import { BN } from "bn.js";
import exp from "constants";

const invest_amount = Sol2pool + (0.01 + 0.3 + 0.4) * LAMPORTS_PER_SOL;

export const computePoolReserve = async (): Promise<{ solReserve: number, price: number } | null> => {
  try{
    const dexInfo = await FileService.getInfo();
    const marketID = new PublicKey(dexInfo.MarketId);

    const poolKeys = await derivePoolKeys(mainWallet, marketID);
    if (poolKeys == null) {
      console.error("Error fetching poolkeys");
      process.exit(1);
    }
    const poolInfo = await Liquidity.fetchInfo({ connection, poolKeys });
    // console.log({poolInfo})
    const solReserve = (new BN(poolInfo.quoteReserve)).toNumber() / 10 ** poolInfo.quoteDecimals;
    const price = solReserve / ((new BN(poolInfo.baseReserve)).toNumber() / 10 ** poolInfo.baseDecimals);
    return { solReserve, price }
  }catch(e){
    console.error('', e);
    return null;
  }
}

export const getProfitX = async (): Promise<number> => {
  const poolData = await computePoolReserve();
  if(poolData){
    const { solReserve, price } = poolData;
    const profit = solReserve - invest_amount;
    const profit_percent = profit * 100 / invest_amount;
    return profit_percent;
  }
  return 0;
}

// getPrice();