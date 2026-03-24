import { Transaction } from "@solana/web3.js";
import { VersionedTransaction } from "@solana/web3.js";
import base58 from "bs58";
import * as fs from "fs";
import { connection } from "../../config";
import ora from "ora";
import chalk from "chalk";

export const FileService = {
  dexInfofile: "./dexinfo.json",
  tokenInfo: "./tokeninfo.json",

  getTokenInfo: async function () {
    if (fs.existsSync(this.tokenInfo)) {
      const data = fs.readFileSync(this.tokenInfo, "utf8");
      const info = JSON.parse(data);
      return {
        name: info.name,
        symbol: info.symbol,
        decimals: info.decimals,
        description: info.description,
        showName: true,
        createdOn: 'https://pump.fun',
        image: info.image,
        totalSupply: info.totalSupply,
        sellerFeeBasisPoints: info.sellerFeeBasisPoints,
      };
    }
    return null;
  },
  getInfo: async function (): Promise<{
    Mint: string;
    MarketId: string;
    LUT: string;
    PoolId: string;
    LPMint: string;
    Wallets: string[];
  }> {
    if (fs.existsSync(this.dexInfofile)) {
      const data = fs.readFileSync(this.dexInfofile, "utf8");
      const { Mint, MarketId, LUT, PoolId, LPMint, Wallets } = JSON.parse(data);
      return { Mint, MarketId, LUT, PoolId, LPMint, Wallets };
    }
    return {
      Mint: "",
      MarketId: "",
      LUT: "",
      PoolId: "",
      LPMint: "",
      Wallets: [],
    };
  },
  saveMint: async function (value: any) {
    let info;
    if (fs.existsSync(this.dexInfofile)) {
      const data = fs.readFileSync(this.dexInfofile, "utf8");
      info = JSON.parse(data);
    }
    info = { ...info, Mint: value };
    fs.writeFileSync(this.dexInfofile, JSON.stringify(info, null, 2));
    console.log("* Saved mint address", value);
  },
  saveMarketId: async function (value: any) {
    let info;
    if (fs.existsSync(this.dexInfofile)) {
      const data = fs.readFileSync(this.dexInfofile, "utf8");
      info = JSON.parse(data);
    }
    info = { ...info, MarketId: value };
    fs.writeFileSync(this.dexInfofile, JSON.stringify(info, null, 2));
    console.log("* Saved market id", value);
  },
  saveLUT: async function (value: any) {
    let info;
    if (fs.existsSync(this.dexInfofile)) {
      const data = fs.readFileSync(this.dexInfofile, "utf8");
      info = JSON.parse(data);
    }
    info = { ...info, LUT: value };
    fs.writeFileSync(this.dexInfofile, JSON.stringify(info, null, 2));
    console.log("* Saved LUT", value.toString());
  },
  savePoolInfo: async function (value: any) {
    let info;
    if (fs.existsSync(this.dexInfofile)) {
      const data = fs.readFileSync(this.dexInfofile, "utf8");
      info = JSON.parse(data);
    }
    info = {
      ...info,
      PoolId: value.id.toString(),
      LPMint: value.lpMint.toString(),
    };
    fs.writeFileSync(this.dexInfofile, JSON.stringify(info, null, 2));
    console.log(
      "* Saved pool info",
      value.id.toString(),
      value.lpMint.toString()
    );
  },
  saveWallets: async function (value: any) {
    let info;
    if (fs.existsSync(this.dexInfofile)) {
      const data = fs.readFileSync(this.dexInfofile, "utf8");
      info = JSON.parse(data);
    }
    info = { ...info, Wallets: value };
    fs.writeFileSync(this.dexInfofile, JSON.stringify(info, null, 2));
    console.log("* Saved wallets", value.length);
  },
};

export function getSignature(
  transaction: Transaction | VersionedTransaction
): string {
  const signature =
    "signature" in transaction
      ? transaction.signature
      : transaction.signatures[0];
  if (!signature) {
    throw new Error(
      "Missing transaction signature, the transaction was not signed by the fee payer"
    );
  }
  return base58.encode(signature);
}

export async function simulateTxns(transactions: VersionedTransaction[]) {
  let isSucceed = true;
  for (let i = 0; i < transactions.length; i++) {
    const simulationResult = await connection.simulateTransaction(
      transactions[i],
      {
        replaceRecentBlockhash: true,
        commitment: "processed",
      }
    );

    if (simulationResult.value.err) {
      isSucceed = false;
      console.log(chalk.red("[Simulation failed]:", simulationResult.value.err));
      simulationResult.value.logs?.forEach((log) => console.log(log));
      break;
      // process.exit(1);
    }
    // console.log('success')
  }
  if(isSucceed)
    console.log(chalk.yellow("[Simulation success]"));
  else{
    await retryAfter();
    await simulateTxns(transactions);
  }
}

export function checkTxnSize(vTxn: VersionedTransaction) {
  const serializedMsg = vTxn.serialize();
  if (serializedMsg.length > 1232) {
    console.error("Transaction size is too large!", serializedMsg.length);
    process.exit(1);
  } else {
    console.log("Txn size:", serializedMsg.length);
  }
}


export function chunkArray<T>(array: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(array.length / size) }, (v, i) =>
    array.slice(i * size, i * size + size)
  );
}

export async function sleepTime(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}


export async function retryAfter(s: number = 5){
  let sec = s;
  const spinner = ora(chalk.gray(`Retring after ${sec}seconds...`)).start();
  while(sec > 0){
    await sleepTime(1000);
    sec--;
    spinner.text = chalk.gray(`Retring after ${sec}seconds...`);
  }
  spinner.stop();
}

// (async () => {
//     const kkk = 1;
//     const aaa = 2;
//     FileService.saveMint(kkk)
//     FileService.saveMarketId(kkk)
//     FileService.savePoolId(aaa)
//     let wallets: any[]= [];
//     for(let i = 0; i < 30; i++){
//         const wallet = Keypair.generate();
//         wallets.push(base58.encode(wallet.secretKey))
//     }
//     FileService.saveWallets(wallets)
// })()
