#!/bin/env node

import * as ada2min from "./scenarios/ada-to-min.js";
import * as min2btc from "./scenarios/min-to-tbtc.js";
import * as packageJson from "../package.json";
import { Command } from "commander";
import * as chalk_ from "chalk";
export const chalk = new chalk_.Chalk();

export const logAbort = (msg: string) => {
  console.log("");
  console.log(`${chalk.red(chalk.bold("ABORT:"))} ${chalk.red(msg)}`);
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
  .action(async () => {
    const err = await ada2min.run();
    if (err) {
      logAbort(err.toString());
    }
  });

program
  .command("min2btc")
  .description(
    `
This scenario submits 2 requests for MIN-to-tBTC swaps:
    ${chalk.blue("6,000,000 MIN, 4,000,000 MIN")}

The router will perform the swap (batch version) using the latest rate
`
  )
  .action(() => {
    try {
      min2btc.run();
    } catch(e) {
      logAbort(e.toString());
    }
  });

program.parse();
