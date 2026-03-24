import { Keypair } from "@solana/web3.js";
import base58 from "bs58";
import { FileService } from "./services/utils";
import { Wallets_num } from "../config";

export async function createWallets(MaxW = 24) {
  const pks: string[] = [];
  for (let i = 0; i < Math.min(Wallets_num, MaxW); i++) {
    const wallet = Keypair.generate();
    pks.push(base58.encode(wallet.secretKey));
  }
  FileService.saveWallets(pks);
}

async function loadWallets(): Promise<string[]> {
  const dexInfo = await FileService.getInfo();
  console.log(dexInfo.Wallets);
  return dexInfo.Wallets;
}

createWallets()
// loadWallets()
