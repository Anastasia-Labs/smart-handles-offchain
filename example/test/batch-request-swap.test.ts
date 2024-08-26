import {
  Emulator,
  Lucid,
  fetchBatchRequestUTxOs,
  PROTOCOL_PARAMETERS_DEFAULT,
  getBatchVAs,
  BatchVAs,
  LucidEvolution,
  batchRoute,
} from "@anastasia-labs/smart-handles-offchain";
import {
  applyMinswapAddressToCBOR,
  mkBatchRouteConfig,
} from "../src/minswap-v1.js";
import {
  LucidContext,
  createUser,
  submitAdaToMinBatchRequests,
  unsafeFromOk,
} from "./utils.js";
import stakingValidator from "../src/uplc/smartHandleStake.json";
import { beforeEach, test } from "vitest";

//NOTE: INITIALIZE EMULATOR + ACCOUNTS
beforeEach<LucidContext>(async (context) => {
  context.users = {
    router: createUser(),
    user1: createUser(),
    user2: createUser(),
    user3: createUser(),
    user4: createUser(),
    adversary: createUser(),
  };

  context.emulator = new Emulator(
    [
      context.users.router,
      context.users.user1,
      context.users.user2,
      context.users.user3,
      context.users.user4,
      context.users.adversary,
    ],
    {
      ...PROTOCOL_PARAMETERS_DEFAULT,
      maxTxSize: 10000000,
      maxTxExMem: BigInt(1400000000),
      maxTxExSteps: BigInt(1000000000000),
    }
  );

  context.lucid = await Lucid(context.emulator, "Custom");
});

async function registerRewardAddress(
  lucid: LucidEvolution,
  rewardAddress: string
): Promise<void> {
  const tx = await lucid.newTx().registerStake(rewardAddress).complete();
  const signedTx = await tx.sign.withWallet().complete();
  await signedTx.submit();
}

test<LucidContext>(
  "Test - Batch Request, Swap",
  async ({ lucid, users, emulator }) => {
    console.log("MAX CPU", emulator.protocolParameters.maxTxExSteps);
    console.log("MAX MEM", emulator.protocolParameters.maxTxExMem);
    const minswapStakingScript = unsafeFromOk(
      applyMinswapAddressToCBOR(stakingValidator.cborHex, "Custom")
    );
    const batchVAs: BatchVAs = getBatchVAs(minswapStakingScript, "Custom");

    // User1 Batch Swap Request
    await submitAdaToMinBatchRequests(
      lucid,
      emulator,
      users.user1.seedPhrase,
      [8_000_000, 20_000_000, 30_000_000, 40_000_000]
    );
    // User2 Batch Swap Request
    await submitAdaToMinBatchRequests(
      lucid,
      emulator,
      users.user2.seedPhrase,
      [30_000_000, 36_000_000, 24_000_000]
    );
    // // User3 Batch Swap Request
    // await submitAdaToMinBatchRequests(
    //   lucid,
    //   emulator,
    //   users.user3.seedPhrase,
    //   [10_000_000, 72_000_000]
    // );
    // // User4 Batch Swap Request
    // await submitAdaToMinBatchRequests(
    //   lucid,
    //   emulator,
    //   users.user4.seedPhrase,
    //   [8_000_000, 10_000_000, 9_000_000, 14_000_000, 13_000_000, 13_400_000]
    // );

    const allRequests = await fetchBatchRequestUTxOs(
      lucid,
      minswapStakingScript,
      "Custom"
    );

    // Valid Swap
    lucid.selectWallet.fromSeed(users.router.seedPhrase);

    // Register Staking Validator's Reward Address
    const rewardAddress = batchVAs.stakeVA.address;
    console.log("REGISTERING REWARD ADDRESS", rewardAddress);
    await registerRewardAddress(lucid, rewardAddress);

    emulator.awaitBlock(100);

    console.log("BUILDING THE SWAP CONFIG");
    const swapConfig = unsafeFromOk(mkBatchRouteConfig(
      BigInt(20),
      allRequests.map((r) => ({
        txHash: r.txHash,
        outputIndex: r.outputIndex,
      })),
      "Custom"
    ));

    console.log("BUILDING SWAP TX");
    const swapTxUnsigned = unsafeFromOk(await batchRoute(lucid, swapConfig));
    console.log("BUILT SWAP TX", swapTxUnsigned);
    const swapTxSigned = await swapTxUnsigned.sign
      .withWallet()
      .complete();
    console.log("SIGNED SWAP TX", swapTxSigned);
    const swapTxHash = await swapTxSigned.submit();
    console.log("SWAP TX HASH", swapTxHash);
  },
  120_000
);
