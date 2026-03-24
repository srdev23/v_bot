import {
  SystemProgram,
  Keypair,
  Connection,
  clusterApiUrl,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createInitializeMintInstruction,
  getMinimumBalanceForRentExemptMint,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  mintTo,
} from "@solana/spl-token";
import { createCreateMetadataAccountV3Instruction } from "@metaplex-foundation/mpl-token-metadata";
import {
  bundlrStorage,
  keypairIdentity,
  Metaplex,
} from "@metaplex-foundation/js";
import ora from "ora";
import chalk from "chalk";
import {
  connection,
  JitoTipIxn,
  mainWallet,
  Mint_add,
  RPC_URL,
} from "../config";
import { sendBundle } from "./services/jito.service";
import { checkTxnSize, FileService, getSignature, retryAfter } from "./services/utils";
import { PublicKey } from "@solana/web3.js";

const getNetworkConfig = (network: any) => {
  return network === "mainnet"
    ? {
        cluster: RPC_URL,
        address: "https://node1.bundlr.network",
        providerUrl: "https://api.mainnet-beta.solana.com",
      }
    : {
        cluster: clusterApiUrl("devnet"),
        address: "https://devnet.bundlr.network",
        providerUrl: "https://api.devnet.solana.com",
      };
};

const createMintTokenTransaction = async (
  connection: any,
  metaplex: any,
  payer: any,
  mintKeypair: any,
  token: any,
  tokenMetadata: any,
  destinationWallet: any,
  mintAuthority: any
) => {
  try {
    if (
      !connection ||
      !metaplex ||
      !payer ||
      !mintKeypair ||
      !token ||
      !tokenMetadata ||
      !destinationWallet ||
      !mintAuthority
    ) {
      throw new Error("Invalid input parameters");
    }

    const requiredBalance = await getMinimumBalanceForRentExemptMint(
      connection
    );

    const metadataPDA = metaplex
      .nfts()
      .pdas()
      .metadata({ mint: mintKeypair.publicKey });
    const tokenATA = await getAssociatedTokenAddress(
      mintKeypair.publicKey,
      destinationWallet
    );
    // const microLamports = 100_000;
    // const cu = 100_000;
    const txInstructions = [];
    txInstructions.push(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mintKeypair.publicKey,
        space: MINT_SIZE,
        lamports: requiredBalance,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMintInstruction(
        mintKeypair.publicKey,
        token.decimals,
        mintAuthority,
        null,
        TOKEN_PROGRAM_ID
      ),
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        tokenATA,
        payer.publicKey,
        mintKeypair.publicKey
      ),
      createMintToInstruction(
        mintKeypair.publicKey,
        tokenATA,
        mintAuthority,
        token.totalSupply * Math.pow(10, token.decimals)
      ),
      createCreateMetadataAccountV3Instruction(
        {
          metadata: metadataPDA,
          mint: mintKeypair.publicKey,
          mintAuthority: mintAuthority,
          payer: payer.publicKey,
          updateAuthority: mintAuthority,
        },
        {
          createMetadataAccountArgsV3: {
            data: tokenMetadata,
            isMutable: true,
            collectionDetails: null,
          },
        }
      ),
      JitoTipIxn
    );
    console.log(chalk.green("Jito tip added :),"));

    const { blockhash } = await connection.getLatestBlockhash();

    const messageV0 = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhash,
      instructions: txInstructions,
    }).compileToV0Message();

    const vTxn = new VersionedTransaction(messageV0);
    checkTxnSize(vTxn);
    vTxn.sign([payer, mintKeypair]);

    return vTxn;
  } catch (error) {
    console.error("Error creating mint token transaction:", error);
    throw error;
  }
};

const uploadMetadata = async (metaplex: any, tokenMetadata: any) => {
  try {
    const { uri } = await metaplex.nfts().uploadMetadata(tokenMetadata);
    return uri;
  } catch (error) {
    console.error("Error uploading token metadata:", error);
    throw error;
  }
};

export const createSPL = async () => {
  try {
    console.log(chalk.blue("\n> Starting token creation process...\n"));

    const network = getNetworkConfig("mainnet");
    const connection = new Connection(network.cluster);
    console.log(chalk.yellow("User wallet address:"),
      mainWallet.publicKey.toString()
    );

    const metaplex = Metaplex.make(connection)
      .use(keypairIdentity(mainWallet))
      .use(
        bundlrStorage({
          address: network.address,
          providerUrl: network.providerUrl,
          timeout: 60000,
        })
      );

    const tokenMetadata = await FileService.getTokenInfo();
    if(!tokenMetadata){
      console.log(chalk.red("Token metadata not found. Please check ./tokeninfo.json file"));
      process.exit(1);
    }

    const token = {
      decimals: tokenMetadata.decimals,
      totalSupply: tokenMetadata.totalSupply,
    };

    console.log(chalk.yellow("Token information:"));
    console.log(chalk.cyan("- Name:"), tokenMetadata.name);
    console.log(chalk.cyan("- Symbol:"), tokenMetadata.symbol);
    console.log(chalk.cyan("- Image URL:"), tokenMetadata.image);
    console.log(
      chalk.cyan("- Royalty:"),
      `${tokenMetadata.sellerFeeBasisPoints} basis points`
    );
    console.log(chalk.cyan("- Decimals:"), tokenMetadata.decimals);
    console.log(chalk.cyan("- Total Supply:"), tokenMetadata.totalSupply, "\n");

    const spinner1 = ora(chalk.yellow("Uploading token metadata...")).start();
    let metadataUri = await uploadMetadata(metaplex, tokenMetadata);
    spinner1.succeed(chalk.green(`Metadata uploaded. URI: ${metadataUri}`));

    const tokenMetadataV2 = {
      ...tokenMetadata,
      uri: metadataUri,
      creators: null,
      collection: null,
      uses: null,
    };

    const spinner2 = ora(chalk.yellow("Generating token address...")).start();
    let mintKeypair = Keypair.generate();
    spinner2.succeed(
      chalk.green(
        `Generated token address: ${mintKeypair.publicKey.toString()}`
      )
    );


    const mintTransaction = await createMintTokenTransaction(
      connection,
      metaplex,
      mainWallet,
      mintKeypair,
      token,
      tokenMetadataV2,
      mainWallet.publicKey,
      mainWallet.publicKey
    );

    // let { lastValidBlockHeight, blockhash } = await connection.getLatestBlockhash("finalized");
    const isSucceed = await sendBundle([mintTransaction]);
    if (isSucceed) {
      const txId = getSignature(mintTransaction);
      const mint = mintKeypair.publicKey.toString();
      FileService.saveMint(mint);
      console.log(
        chalk.green(
          `View transaction on Solana Explorer: https://solscan.io/tx/${txId}`
        )
      ); //?cluster=${answers.network}`));
      console.log(
        chalk.green(
          `View new SPL token on Solana Explorer: https://solscan.io/token/${mint}`
        )
      ); //?cluster=${answers.network}`));
    } else {
      console.log(chalk.red("Transaction failed."));
      process.exit(1);
    }
  } catch (error) {
    console.error("An error occurred:", error);
    await retryAfter();
    await createSPL();
    // process.exit(1);
  }
};

export const mintAddToken = async () => {
  try {
    const spinner1 = ora(chalk.yellow("Minting tokens more...", Mint_add)).start();
    const tokenMetadata = await FileService.getTokenInfo();
    if(!tokenMetadata){
      console.log(chalk.red("Token metadata not found. Please check ./tokeninfo.json file"));
      process.exit(1);
    }
    const dexInfo = await FileService.getInfo();
    const mint = new PublicKey(dexInfo.Mint);
    const ata = await getAssociatedTokenAddress(mint, mainWallet.publicKey);
    await mintTo(
      connection,
      mainWallet,
      mint,
      ata,
      mainWallet.publicKey,
      Mint_add * 10 ** tokenMetadata.decimals
    );
    spinner1.succeed(chalk.green(`Succeefully minted ${Mint_add}`));
  } catch (e) {
    console.error("While minting more tokens", e);
    await retryAfter();
    await mintAddToken();
    // process.exit(1);
  }
};

// main();
// mintAddToken();
