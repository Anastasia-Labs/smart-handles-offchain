// export * from "./endpoints/index.js"
// export * from "./core/index.js"
// export * from "@lucid-evolution/lucid"


import { Lucid, Blockfrost } from "@lucid-evolution/lucid";
import { BLOCKFROST_PROJECT_ID, BLOCKFROST_URL, NETWORK, SEED_PHRASE } from "./constant.js";

async function main(){
const lucid = await Lucid(
  new Blockfrost(BLOCKFROST_URL, BLOCKFROST_PROJECT_ID),
  NETWORK
);

const seedPhrase = SEED_PHRASE
lucid.selectWallet.fromSeed(seedPhrase);
const address = await lucid.wallet().address();
console.log("address :>> ", address);
const rewardAddress = await lucid.wallet().rewardAddress();
if (!rewardAddress) {
  throw new Error("No reward address found");
}
console.log("reward address :>> ", rewardAddress);
lucid.selectWallet.fromSeed(seedPhrase);
const vote = await lucid
  .newTx()
  .registerStake(rewardAddress)
  .delegate.ToPool(
    rewardAddress,
    "pool1ywazc6h66tamsfxpfncfhhj282y0j420sze45x3s5qdvkaxssse"
  )
  .delegate.VoteToDRep(rewardAddress, {
    __typename: "AlwaysAbstain",
  })
  .setMinFee(300000n)
  .complete();

const voteSigned = await vote.sign.withWallet().complete();
const voteTxHash = await voteSigned.submit();
console.log(`Transaction submitted: ${voteTxHash}`);
console.log(`Confirming Transaction...`);
await lucid.awaitTx(voteTxHash, 40_000);

const signBuilder = await lucid
  .newTx()
  .deRegisterStake(rewardAddress)
  .setMinFee(300000n)
  .complete();
const signed = await signBuilder.sign.withWallet().complete();
const txHash = await signed.submit();
console.log(`🚀 Transaction submitted: ${txHash}`);
console.log(`Confirming Transaction...`);
await lucid.awaitTx(txHash, 40_000);
}
main();



