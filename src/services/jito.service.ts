import { Keypair } from "@solana/web3.js";
import { Bundle as JitoBundle } from "jito-ts/dist/sdk/block-engine/types.js";

import {
  SearcherClient,
  searcherClient as jitoSearcherClient,
} from "jito-ts/dist/sdk/block-engine/searcher.js";
import * as fs from "fs";
import { VersionedTransaction } from "@solana/web3.js";
import axios from "axios";
import ora from "ora";
import chalk from "chalk";
import { retryAfter, simulateTxns, sleepTime } from "./utils";

const BLOCK_ENGINE_URL = "frankfurt.mainnet.block-engine.jito.wtf";

const decodedKey = new Uint8Array(
  JSON.parse(fs.readFileSync("./blockengine.json").toString()) as number[]
);
const keypair = Keypair.fromSecretKey(decodedKey);
const client: SearcherClient = jitoSearcherClient(BLOCK_ENGINE_URL, keypair, {
  "grpc.keepalive_timeout_ms": 4000,
});

export async function sendBundle(bundledTxns: VersionedTransaction[], simulateTxn = true) {
  if(simulateTxn)
    await simulateTxns(bundledTxns);
  // return;
  const spinner = ora(chalk.yellow("Sendig bundle txn...")).start();
  try {
    const bundleId = await client.sendBundle(
      new JitoBundle(bundledTxns, bundledTxns.length)
    );

    const isSucceed = await getBundleStatus(bundleId);
    if (isSucceed) {
      spinner.succeed(chalk.green("[Bundle success!]"));
      console.log(
        chalk.green(
          "🎉 JitoTransaction confirmed!",
          `https://explorer.jito.wtf/bundle/${bundleId}`
        )
      );
      return true;
    } else {
      spinner.fail(chalk.red("Bundle failed!"));
      await retryAfter();
      return await sendBundle(bundledTxns, simulateTxn);
      // process.exit(1);
    }
  } catch (error) {
    const err = error as any;
    spinner.fail(chalk.red(`Bundle failed! ${err.message}`));

    if (err?.message?.includes("Bundle Dropped, no connected leader up soon")) {
      console.error(
        "Error sending bundle: Bundle Dropped, no connected leader up soon."
      );
    } else {
      console.error("An unexpected error occurred:", err.message);
    }

    await retryAfter();
    return await sendBundle(bundledTxns, simulateTxn);
    // process.exit(1);
  }
}

async function getBundleStatus(bundleId: string) {
  const payload = {
    jsonrpc: "2.0",
    id: 1,
    method: "getBundleStatuses",
    params: [[bundleId]],
  };

  let retries = 0;
  const MAX_CHECK_JITO = 40;
  while (retries < MAX_CHECK_JITO) {
    try {
      retries++;
      const jitoURL = `https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles`; // ?uuid=${JITO_UUID}

      const response = await axios.post(jitoURL, payload, {
        headers: { "Content-Type": "application/json" },
      });

      if (!response || response.data.result.value.length <= 0) {
        await sleepTime(1000);
        continue;
      }

      const bundleResult = response.data.result.value[0];
      if (
        bundleResult.confirmation_status === "confirmed" ||
        bundleResult.confirmation_status === "finalized"
      ) {
        retries = 0;
        break;
      }
    } catch (error) {
      // console.error("GetBundleStatus Failed");
    }
  }
  if (retries === 0) return true;
  return false;
}
