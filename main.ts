import { createMarket } from "./src/createMarket";
import { createSPL, mintAddToken } from "./src/createSPL";
import inquirer from "inquirer";
import chalk from "chalk";
import { createPool } from "./src/createPool";
import { createWallets } from "./src/createWallets";
import { createLUT, extendLUT } from "./src/createLUT";
import { distributeWSOL } from "./src/distributeSOL";
import { buy_sell } from "./src/buy_sell";
import { removeLiquidity } from "./src/removeLiq";
import { sellAlltoken } from "./src/sellAlltoken";
import { getProfitX } from "./src/computeProfit";
import { Delay_t, MaxIteration, Profit_x } from "./config";
import { sleepTime } from "./src/services/utils";

const choices: any[] = [
    "a) All below processes",
    "b) Create new SPL token",
    "c) Create new market ID",
    "d) Create & init new pool",
    "e) Start volume bot",
    "f) Mint more token",
    "g) Sell all tokens",
    "h) Remove LP",
    "i) Exit",
    new inquirer.Separator("____________________________"),
  ]

const askQuestions = async () => {
  try {
    const questions = [
      {
        type: "list",
        name: "action",
        message: "Choose the action you want to perform:",
        choices,
        default: 0,
      },
    ];
    //@ts-ignore
    return await inquirer.prompt(questions);
  } catch (error) {
    console.error("Error while asking questions:", error);
    throw error;
  }
};

const startAllProcesses = async () => {
  await createSPL();
  await createMarket();
  await createPool();
  await startVolumeBot();
}

const startVolumeBot = async () => {
  let i = 0;
  const MAX_TXNs = 100000;
  while (true && i++ < MAX_TXNs) {
    await createWallets();
    await createLUT();
    await extendLUT();

    await distributeWSOL();
    await buy_sell();

    await sleepTime(Delay_t);

    const xProfit = await getProfitX();
    if(xProfit && xProfit >= Profit_x){
      console.log(chalk.green("X Profit is greater than X_Profit, exiting..."));
      break;
    }
  }

  await mintAddToken();
  await sellAlltoken();
  await removeLiquidity();

  console.log(chalk.green("All processes completed."));
}

(async () => {
  console.log(chalk.blue("Stating..."));
  while(true){
    const answers = await askQuestions();
    console.log(chalk.yellow("Action selected:"), answers.action);
  
    switch(answers.action){
      case choices[0]:
          await startAllProcesses();
          break;
      case choices[1]:
          await createSPL();
          break;
      case choices[2]:
          await createMarket();
          break;
      case choices[3]:
          await createPool();
          break;
      case choices[4]:
          await startVolumeBot();
          break;
      case choices[5]:
          await mintAddToken();
          break;
      case choices[6]:
        await sellAlltoken();
        break;
      case choices[7]:
          await removeLiquidity();
          break;
      case choices[8]:
          process.exit(1);
      default: break;
    }  
  }
})();
