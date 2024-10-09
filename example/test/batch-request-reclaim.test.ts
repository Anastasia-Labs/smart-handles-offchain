import {
  applyMinswapAddressToCBOR,
  fetchUsersBatchRequestUTxOs,
  mkBatchReclaimConfig,
} from "../src/minswap-v1.js";
import {
  Emulator,
  Lucid,
  BatchReclaimConfig,
  batchReclaim,
  getBatchVAs,
  registerRewardAddress,
  BatchVAs,
  PROTOCOL_PARAMETERS_DEFAULT,
} from "@anastasia-labs/smart-handles-offchain";
import {
  LucidContext,
  createUser,
  submitAdaToMinBatchRequests,
  unsafeFromOk,
} from "./utils.js";
import stakingValidator from "../src/uplc/smartHandleStake.json";
import { beforeEach, expect, test } from "vitest";

//NOTE: INITIALIZE EMULATOR + ACCOUNTS
beforeEach<LucidContext>(async (context) => {
  context.users = {
    user1: createUser(),
    user2: createUser(),
  };

  context.emulator = new Emulator([context.users.user1, context.users.user2], {
    ...PROTOCOL_PARAMETERS_DEFAULT,
    maxTxSize: 10000000,
    maxTxExMem: BigInt(1400000000),
    maxTxExSteps: BigInt(1000000000000),
  });

  context.lucid = await Lucid(context.emulator, "Custom");
});

test<LucidContext>("Test - Batch Swap Request, Reclaim", async ({
  lucid,
  users,
  emulator,
}) => {
  lucid.selectWallet.fromSeed(users.user1.seedPhrase);
  const minswapStakingScript = unsafeFromOk(
    applyMinswapAddressToCBOR(stakingValidator.cborHex, "Custom")
  );
  const batchVAs: BatchVAs = getBatchVAs(minswapStakingScript, "Custom");

  // Batch Swap Request
  await submitAdaToMinBatchRequests(
    lucid,
    emulator,
    users.user1.seedPhrase,
    [8_000_000, 20_000_000, 10_000_000, 25_000_000]
  );

  const user1Requests = unsafeFromOk(
    await fetchUsersBatchRequestUTxOs(lucid, users.user1.address)
  );

  // Register Staking Validator's Reward Address
  const rewardAddress = batchVAs.stakeVA.address;
  await registerRewardAddress(lucid, rewardAddress);
  emulator.awaitBlock(100);

  // Valid Batch Reclaim
  lucid.selectWallet.fromSeed(users.user1.seedPhrase);
  const user1ReclaimConfig = unsafeFromOk(
    mkBatchReclaimConfig(
      user1Requests.map((u) => u.outRef),
      "Custom"
    )
  );

  const reclaimUnsigned1 = unsafeFromOk(
    await batchReclaim(lucid, user1ReclaimConfig)
  );

  const reclaimSigned1 = await reclaimUnsigned1.sign.withWallet().complete();
  try {
    const reclaimSignedHash1 = await reclaimSigned1.submit();
  } catch (e) {
    console.dir(e, {depth: null});
  }

  // console.log("BATCH RECLAIM 1 TX HASH", reclaimSignedHash1);

  emulator.awaitBlock(100);

  // Repeat Batch Request
  await submitAdaToMinBatchRequests(
    lucid,
    emulator,
    users.user2.seedPhrase,
    [8_000_000, 20_000_000, 10_000_000, 25_000_000]
  );

  const user1Requests2 = unsafeFromOk(
    await fetchUsersBatchRequestUTxOs(lucid, users.user1.address)
  );

  // Attempt Batch Reclaim of user1 UTxOs by user2
  lucid.selectWallet.fromSeed(users.user2.seedPhrase);
  const user2ReclaimConfig: BatchReclaimConfig = unsafeFromOk(
    mkBatchReclaimConfig(
      user1Requests2.map((u) => u.outRef),
      "Custom"
    )
  );

  const reclaimUnsigned2 = await batchReclaim(lucid, user2ReclaimConfig);

  expect(reclaimUnsigned2.type).toBe("error");
});
