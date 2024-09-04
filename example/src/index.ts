#!/bin/env node

import * as minswap from "./minswap-v1.js";
import * as ada2min from "./scenarios/ada-to-min.js";
import * as min2btc from "./scenarios/min-to-tbtc.js";
import * as packageJson from "../package.json";
import { Command } from "commander";
import * as chalk_ from "chalk";
import {
  SpendingValidator,
  getAddressDetails,
  validatorToAddress,
  validatorToScriptHash,
} from "@anastasia-labs/smart-handles-offchain";

export const minswapv1 = minswap;
export const chalk = new chalk_.Chalk();

const logAbort = (msg: string) => {
  console.log("");
  console.log(`${chalk.red(chalk.bold("ABORT:"))} ${chalk.red(msg)}`);
};

const fromAction = (
  action: (bf: string, sp: string, rsp: string) => Promise<Error | void>
): (() => Promise<void>) => {
  const blockfrostKey = process.env.BLOCKFROST_KEY;
  // Seed phrases are space separated words
  const seedPhrase = process.env.SEED_PHRASE;
  const routingAgentsSeedPhrase = process.env.ROUTING_SEED_PHRASE;
  return async () => {
    if (!blockfrostKey) {
      logAbort("No Blockfrost API key was found (BLOCKFROST_KEY)");
    } else if (!seedPhrase) {
      logAbort("No wallet seed phrase found (SEED_PHRASE)");
    } else if (!routingAgentsSeedPhrase) {
      logAbort(
        "Routing agent's wallet seed phrase not found (ROUTING_SEED_PHRASE)"
      );
    } else {
      const err = await action(
        blockfrostKey,
        seedPhrase,
        routingAgentsSeedPhrase
      );
      if (err) {
        logAbort(err.toString());
      }
    }
  };
};

const program: Command = new Command();

program.version(packageJson.default.version).description(`
${packageJson.default.description}

Use either ada2min or min2btc. But make sure you've first set these three
environment variables:

\u0009${chalk.bold("BLOCKFROST_KEY")}      \u0009 Your Blockfrost API key
\u0009${chalk.bold("SEED_PHRASE")}         \u0009 Your wallet seed phrase
\u0009${chalk.bold("ROUTING_SEED_PHRASE")} \u0009 Router's wallet seed phrase
`);

program
  .command("ada2min")
  .description(
    `
This scenario submits 5 requests for ADA-to-MIN swaps:
    ${chalk.blue("50 ADA, 100 ADA, 150 ADA, 200 ADA, 250 ADA")}

The router will perform the swap (batch version) using the latest rate
`
  )
  .action(fromAction(ada2min.run));

program
  .command("min2btc")
  .description(
    `
This scenario submits 2 requests for MIN-to-tBTC swaps:
    ${chalk.blue("6,000,000 MIN, 4,000,000 MIN")}

The router will perform the swap (batch version) using the latest rate
`
  )
  .action(fromAction(min2btc.run));

program
  .command("test")
  .description("<< For testing purposes >>")
  .action(() => {
    const validator: SpendingValidator = {
      type: "PlutusV2",
      script:
        "583b010000323232322253330033370e900018021baa001153330034a229309b2b09912999802a5114984d958c018c014dd5000ab9a5573aaae795d081",
    };
    const scriptHash = validatorToScriptHash(validator);
    const scriptAddr = validatorToAddress("Preprod", validator);
    const addrDeets = getAddressDetails(
      "addr_test1xqweycval58x8ryku838tjqypgjzfs3t4qjj0pwju6prgmjwsw5k2ttkze7e9zd3jr00x5nkhmpx97cv6xx25jsgxh2swlkfgp"
    );
    console.log("Always Succeeds Script Hash");
    console.log(chalk.white(chalk.bold(scriptHash)));
    console.log("Always Succeeds Address");
    console.log(chalk.white(chalk.bold(scriptAddr)));
    console.log("Always Succeeds Address Details");
    console.log(chalk.white(chalk.bold(JSON.stringify(addrDeets))));
  });

program.parse();
