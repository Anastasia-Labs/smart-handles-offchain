import {
  Emulator,
  Lucid,
  generateAccountSeedPhrase,
  BatchRequestConfig,
  BatchReclaimConfig,
  batchRequest,
  FetchUsersBatchRequestConfig,
  userBatchRequestUTxOs,
  batchReclaim,
  WithdrawalValidator,
  FetchBatchRequestConfig,
  getBatchRequestUTxOs,
} from "../src/index.js";
import { beforeEach, expect, test } from "vitest";
import spendingValidator from "./smartHandleRouter.json" assert { type : "json" };
import stakingValidator from "./smartHandleStake.json" assert { type : "json" };

async function registerRewardAddress(lucid: Lucid): Promise<void> {
  const stakingVal : WithdrawalValidator = {
    type: "PlutusV2",
    script: stakingValidator.cborHex
  }

  const rewardAddress = lucid.utils.validatorToRewardAddress(stakingVal);

  const tx = await lucid
    .newTx()
    .registerStake(rewardAddress)
    .complete();
  const signedTx = await tx.sign().complete();
  await signedTx.submit();
}

type LucidContext = {
  lucid: Lucid;
  users: any;
  emulator: Emulator;
};

//NOTE: INITIALIZE EMULATOR + ACCOUNTS
beforeEach<LucidContext>(async (context) => {
  const createUser = async () => {
    return await generateAccountSeedPhrase({lovelace: BigInt(100_000_000)});
  };
  context.users = {
    swapAccount: await createUser(),
    user1: await createUser(),
  };

  context.emulator = new Emulator([
    context.users.swapAccount,
    context.users.user1,
  ]);

  context.lucid = await Lucid.new(context.emulator);
});

test<LucidContext>("Test - Request Single Swap, Reclaim", async ({
  lucid,
  users,
  emulator,
}) => {
  const scripts = {
      spending: spendingValidator.cborHex,
      staking: stakingValidator.cborHex,
  };
  const requestConfig: BatchRequestConfig = {
    swapAddress: users.swapAccount.address,
    owner: users.user1.address,
    lovelaces: [
      BigInt(5_000_000),
      BigInt(20_000_000),
      BigInt(30_000_000),
      BigInt(40_000_000),
    ],
    scripts,
  };

  lucid.selectWalletFromSeed(users.user1.seedPhrase);

  const requestUnsigned = await batchRequest(lucid, requestConfig);
  expect(requestUnsigned.type).toBe("ok");
  if (requestUnsigned.type == "ok") {
    const requestSigned = await requestUnsigned.data.sign().complete();
    const requestTxHash = await requestSigned.submit();
    console.log("BATCH REQUEST TX HASH", requestTxHash);
  }

  emulator.awaitBlock(100);

  // NOTE: Swap Request 1
  const batchRequestConfig: FetchBatchRequestConfig = {
    swapAddress: users.swapAccount.address,
    scripts,
  };

  const allRequests = await getBatchRequestUTxOs(
    lucid,
    batchRequestConfig,
  );

  const reclaimConfig: BatchReclaimConfig = {
    requestOutRefs: allRequests.map(u => u.outRef),
    swapAddress: users.swapAccount.address,
    scripts,
  };

  // // NOTE: Invalid Reclaim 1
  // lucid.selectWalletFromSeed(users.user2.seedPhrase);
  // const invalidReclaim = await singleReclaim(lucid, reclaimConfig);

  // expect(invalidReclaim.type).toBe("error");

  // if (invalidReclaim.type == "ok") return;

  // console.log("Invalid Reclaim 1");
  // console.log(`Failed. Response: ${invalidReclaim.error}`);

  // Valid Batch Reclaim
  lucid.selectWalletFromSeed(users.user1.seedPhrase);
  const reclaimUnsigned1 = await batchReclaim(lucid, reclaimConfig);

  // console.log(reclaimUnsigned1);
  expect(reclaimUnsigned1.type).toBe("ok");

  if (reclaimUnsigned1.type == "error") {
    // console.log(reclaimUnsigned1.error);
    return;
  }
  const reclaimSigned1 = await reclaimUnsigned1.data.sign().complete();
  const reclaimSignedHash1 = await reclaimSigned1.submit();

  emulator.awaitBlock(100);
});
