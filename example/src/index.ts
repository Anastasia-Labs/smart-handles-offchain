#!/bin/env node

import * as minswap from "./minswap-v1.js";
import * as ada2min from "./scenarios/ada-to-min.js";
import * as min2btc from "./scenarios/min-to-tbtc.js";
import * as packageJson from "../package.json";
import { Command } from "commander";
import * as chalk_ from "chalk";
import {
  Blockfrost,
  Lucid,
  MintingPolicy,
  SpendingValidator,
  getAddressDetails,
  mintingPolicyToId,
  ok,
  validatorToAddress,
  validatorToScriptHash,
} from "@anastasia-labs/smart-handles-offchain";
import {logSuccess, showOutRef, showShortOutRef} from "@anastasia-labs/smart-handles-agent";

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
  .action(async () => {
    const validator: SpendingValidator = {
      type: "PlutusV3",
      script:
        "5834010100323232322533300232323232324a260106012004600e002600e004600a00260066ea8004526136565734aae795d0aba201",
    };
    const mintValidator: MintingPolicy = {
      type: "PlutusV2",
      script:
        "590b04590b01010000332323322332232323232323232323232323232323232323232323232323233223232222323253353232323500822323232533553353233029502e001323500122222222222200850061622135002222533500413232533500210011031333573466e2000920000310303301a0033500c223333500123263202d3357389201024c680002d200123263202d3357389201024c680002d23263202d3357389201024c680002d2216102b15335001102b1335738920103686d6d0002a3232333573466e1c005200202c02b3002001323500122222222222233355301f1200133502022335530201200123500122335503f0023355302312001235001223355042002333500123303c4800000488cc0f40080048cc0f00052000001335530201200123500122335503f002333500123355302412001235001223355043002355026001001223335550210280020012335530241200123500122335504300235502500100133355501c02300200150392350012235001222200300c50053200135502d223350014800088d4008894cd4ccd5cd19b8f00200902f02e13007001130060033200135502c223350014800088d4008894cd4ccd5cd19b8f00200702e02d100113006003135001220023333573466e1cd55cea801a4000466442466002006004646464646464646464646464646666ae68cdc39aab9d500c480008cccccccccccc88888888888848cccccccccccc00403403002c02802402001c01801401000c008cd407807cd5d0a80619a80f00f9aba1500b33501e02035742a014666aa044eb94084d5d0a804999aa8113ae502135742a01066a03c04e6ae85401cccd540880a1d69aba150063232323333573466e1cd55cea801240004664424660020060046464646666ae68cdc39aab9d5002480008cc8848cc00400c008cd40c9d69aba150023033357426ae8940088c98c80d4cd5ce01b01a81989aab9e5001137540026ae854008c8c8c8cccd5cd19b8735573aa004900011991091980080180119a8193ad35742a00460666ae84d5d1280111931901a99ab9c036035033135573ca00226ea8004d5d09aba2500223263203133573806406205e26aae7940044dd50009aba1500533501e75c6ae854010ccd540880908004d5d0a801999aa8113ae200135742a004604c6ae84d5d1280111931901699ab9c02e02d02b135744a00226ae8940044d5d1280089aba25001135744a00226ae8940044d5d1280089aba25001135744a00226ae8940044d55cf280089baa00135742a006602c6ae84d5d1280191931900f99ab9c02001f01d3333573466e1cd55ce9baa0044800080788c98c8078cd5ce00f80f00e080e89931900e99ab9c4901035054350001d135573ca00226ea8004444888ccd54c010480054084cd54c01c480048d400488cd54098008d54024004ccd54c0104800488d4008894cd4ccd54c03048004c8cd403888ccd400c88008008004d40048800448cc004894cd4008409c40040908d400488cc028008014018400c4cd409401000d4088004cd54c01c480048d400488c8cd5409c00cc004014c8004d5409c894cd40044d5402800c884d4008894cd4cc03000802044888cc0080280104c01800c008c8004d5408088448894cd40044008884cc014008ccd54c01c480040140100044484888c00c0104484888c004010c8004d540748844894cd40045407c884cd4080c010008cd54c01848004010004c8004d5407088448894cd40044d400c88004884ccd401488008c010008ccd54c01c4800401401000448848cc00400c00888ccd5cd19b8f0020010180171232230023758002640026aa034446666aae7c0049406c8cd4068c010d5d080118019aba2002012232323333573466e1cd55cea8012400046644246600200600460146ae854008c014d5d09aba2500223263201233573802602402026aae7940044dd50009191919191999ab9a3370e6aae75401120002333322221233330010050040030023232323333573466e1cd55cea8012400046644246600200600460266ae854008cd4034048d5d09aba2500223263201733573803002e02a26aae7940044dd50009aba150043335500875ca00e6ae85400cc8c8c8cccd5cd19b875001480108c84888c008010d5d09aab9e500323333573466e1d4009200223212223001004375c6ae84d55cf280211999ab9a3370ea00690001091100191931900c99ab9c01a019017016015135573aa00226ea8004d5d0a80119a804bae357426ae8940088c98c804ccd5ce00a00980889aba25001135744a00226aae7940044dd5000899aa800bae75a224464460046eac004c8004d5405c88c8cccd55cf8011280c919a80c19aa80d18031aab9d5002300535573ca00460086ae8800c0404d5d080089119191999ab9a3370ea0029000119091180100198029aba135573ca00646666ae68cdc3a801240044244002464c6402066ae700440400380344d55cea80089baa001232323333573466e1d400520062321222230040053007357426aae79400c8cccd5cd19b875002480108c848888c008014c024d5d09aab9e500423333573466e1d400d20022321222230010053007357426aae7940148cccd5cd19b875004480008c848888c00c014dd71aba135573ca00c464c6402066ae7004404003803403002c4d55cea80089baa001232323333573466e1cd55cea80124000466442466002006004600a6ae854008dd69aba135744a004464c6401866ae700340300284d55cf280089baa0012323333573466e1cd55cea800a400046eb8d5d09aab9e500223263200a33573801601401026ea80048c8c8c8c8c8cccd5cd19b8750014803084888888800c8cccd5cd19b875002480288488888880108cccd5cd19b875003480208cc8848888888cc004024020dd71aba15005375a6ae84d5d1280291999ab9a3370ea00890031199109111111198010048041bae35742a00e6eb8d5d09aba2500723333573466e1d40152004233221222222233006009008300c35742a0126eb8d5d09aba2500923333573466e1d40192002232122222223007008300d357426aae79402c8cccd5cd19b875007480008c848888888c014020c038d5d09aab9e500c23263201333573802802602202001e01c01a01801626aae7540104d55cf280189aab9e5002135573ca00226ea80048c8c8c8c8cccd5cd19b875001480088ccc888488ccc00401401000cdd69aba15004375a6ae85400cdd69aba135744a00646666ae68cdc3a80124000464244600400660106ae84d55cf280311931900619ab9c00d00c00a009135573aa00626ae8940044d55cf280089baa001232323333573466e1d400520022321223001003375c6ae84d55cf280191999ab9a3370ea004900011909118010019bae357426aae7940108c98c8024cd5ce00500480380309aab9d50011375400224464646666ae68cdc3a800a40084244400246666ae68cdc3a8012400446424446006008600c6ae84d55cf280211999ab9a3370ea00690001091100111931900519ab9c00b00a008007006135573aa00226ea80048c8cccd5cd19b87500148008802c8cccd5cd19b87500248000802c8c98c8018cd5ce00380300200189aab9d37540029309000a48103505431002233700004002640026aa00e444a66a00220044426a004446600e66601000400c002006640026aa00c4444a66a00220044426a00444a66a666ae68cdc3800a4000014012266601000e00c006266601000e66a0162466600201000600400c006244004244002224400424424466002008006224424660020060042246460020024466006600400400266a2446600491011c2707ef39e2521117d2d3851ef80ad17737eb8294a58397948aa285680048810a4d436865636b436f696e0022123300100300220011",
    };
    const mintPolicyId = mintingPolicyToId(mintValidator);
    const scriptHash = validatorToScriptHash(validator);
    const scriptAddr = validatorToAddress("Preprod", validator);
    const addrDeets = getAddressDetails(scriptAddr);
    console.log("Always Succeeds Script Hash");
    console.log(chalk.white(chalk.bold(scriptHash)));
    console.log("Always Succeeds Address");
    console.log(chalk.white(chalk.bold(scriptAddr)));
    console.log("Always Succeeds Address Details");
    console.log(chalk.white(chalk.bold(JSON.stringify(addrDeets))));
    console.log("Preprod Minting Policy ID");
    console.log(chalk.white(chalk.bold(mintPolicyId)));

    const lucid = await Lucid(
      new Blockfrost(
        "https://cardano-preprod.blockfrost.io/api/v0",
        "preprodMMFt7Qlw8JTt67t05BfuNb8h9bgLaSvw"
      ),
      "Preprod"
    );

    const seedPhrase =
      "guilt bean bind little tide twist maid author capital super doll symbol abandon charge chat true artist dry they recall about assist average idle";

    lucid.selectWallet.fromSeed(seedPhrase);

    const ownAddr = await lucid.wallet().address();

    const freeUSD = `${scriptHash}46726565555344`;
    const freeBTC = `${scriptHash}46726565425443`;
    const freeETH = `${scriptHash}46726565455448`;

    console.log("Minting 1000 million always succeeds tokens...");
    const payToAlwaysSucceedsTx = await lucid
      .newTx()
      .mintAssets({ [freeUSD]: BigInt(1_000_000_000_000) }, "d87980")
      .attach.MintingPolicy(validator)
      .pay.ToAddress(ownAddr, { lovelace: BigInt(10_000_000), [freeUSD]: BigInt(1_000_000_000_000) })
      .complete();
    await minswap.signAndSubmitTxRes(lucid, ok(payToAlwaysSucceedsTx));
    console.log("Done.");

    // console.log("Fetching UTxOs...");
    // const alwaysSucceedsUTxOs = await lucid.utxosAt(scriptAddr);
    // console.log(chalk.white(alwaysSucceedsUTxOs.map(showShortOutRef).join(", ")));
    // console.log("Building tx...");
    // const retreiveTx = await lucid
    //   .newTx()
    //   .collectFrom(alwaysSucceedsUTxOs, "d87980")
    //   .attach.SpendingValidator(validator)
    //   .complete();
    // console.log("Signing and submitting tx...");
    // const txHash = await minswap.signAndSubmitTxRes(lucid, ok(retreiveTx));
    // logSuccess(txHash);
  });

program.parse();
