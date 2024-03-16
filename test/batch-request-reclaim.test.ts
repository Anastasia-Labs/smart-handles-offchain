import {
  Address,
  Emulator,
  Lucid,
  generateAccountSeedPhrase,
  BatchRequestConfig,
  BatchReclaimConfig,
  batchRequest,
  FetchUsersBatchRequestConfig,
  userBatchRequestUTxOs,
  batchReclaim,
  FetchBatchRequestConfig,
  getBatchRequestUTxOs,
} from "../src/index.js";
import { beforeEach, expect, test } from "vitest";
import spendingValidator from "./smartHandleRouter.json" assert { type : "json" };
import stakingValidator from "./smartHandleStake.json" assert { type : "json" };

type LucidContext = {
  lucid: Lucid;
  users: any;
  emulator: Emulator;
};

//NOTE: INITIALIZE EMULATOR + ACCOUNTS
beforeEach<LucidContext>(async (context) => {
  const createUser = async () => {
    return await generateAccountSeedPhrase({ lovelace: BigInt(100_000_000) });
  };
  context.users = {
    swapAccount: await createUser(),
    user1: await createUser(),
    user2: await createUser(),
  };

  context.emulator = new Emulator([
    context.users.swapAccount,
    context.users.user1,
    context.users.user2,
  ]);

  context.lucid = await Lucid.new(context.emulator);
});

const scripts = {
  spending: spendingValidator.cborHex,
  staking: stakingValidator.cborHex,
};

const makeRequestConfig = (
  swapAddr: Address,
  ownerAddr: Address,
  lovelaces: number[]
): BatchRequestConfig => {
  return {
    swapAddress: swapAddr,
    owner: ownerAddr,
    lovelaces: lovelaces.map(BigInt),
    scripts,
  };
};

const makeReclaimConfig = async (
  lucid: Lucid,
  swapAddr: Address,
  ownerAddr: Address,
): Promise<BatchReclaimConfig> => {
  const batchRequestConfig: FetchUsersBatchRequestConfig = {
    owner: ownerAddr,
    swapAddress: swapAddr,
    scripts,
  };
  const userRequests = await userBatchRequestUTxOs(lucid, batchRequestConfig);
  return {
    requestOutRefs: userRequests.map((u) => u.outRef),
    swapAddress: swapAddr,
    scripts,
  };
};

test<LucidContext>("Test - Batch Swap Request, Reclaim", async ({
  lucid,
  users,
  emulator,
}) => {
  // Batch Swap Request
  lucid.selectWalletFromSeed(users.user1.seedPhrase);

  const requestConfig: BatchRequestConfig = makeRequestConfig(
    users.swapAccount.address,
    users.user1.address,
    [5_000_000, 20_000_000, 30_000_000, 40_000_000]
  );

  const requestUnsigned1 = await batchRequest(lucid, requestConfig);

  expect(requestUnsigned1.type).toBe("ok");

  if (requestUnsigned1.type == "ok") {
    const requestSigned1 = await requestUnsigned1.data.sign().complete();
    const requestTxHash1 = await requestSigned1.submit();
    // console.log("BATCH REQUEST 1 TX HASH", requestTxHash1);
  }

  emulator.awaitBlock(100);

  // Valid Batch Reclaim
  const reclaimConfig1: BatchReclaimConfig = await makeReclaimConfig(
    lucid,
    users.swapAccount.address,
    users.user1.address,
  );

  const reclaimUnsigned1 = await batchReclaim(lucid, reclaimConfig1);

  expect(reclaimUnsigned1.type).toBe("ok");

  if (reclaimUnsigned1.type == "ok") {
    const reclaimSigned1 = await reclaimUnsigned1.data.sign().complete();
    const reclaimSignedHash1 = await reclaimSigned1.submit();
    // console.log("BATCH RECLAIM 1 TX HASH", reclaimSignedHash1);
  }

  emulator.awaitBlock(100);

  // Repeat Batch Request
  const requestUnsigned2 = await batchRequest(lucid, requestConfig);

  expect(requestUnsigned2.type).toBe("ok");

  if (requestUnsigned2.type == "ok") {
    const requestSigned2 = await requestUnsigned2.data.sign().complete();
    const requestTxHash2 = await requestSigned2.submit();
    // console.log("BATCH REQUEST 2 TX HASH", requestTxHash2);
  }

  emulator.awaitBlock(100);

  // Attempt Batch Reclaim of user1 UTxOs by user2
  lucid.selectWalletFromSeed(users.user2.seedPhrase);
  const reclaimConfig2: BatchReclaimConfig = await makeReclaimConfig(
    lucid,
    users.swapAccount.address,
    users.user1.address,
  );

  const reclaimUnsigned2 = await batchReclaim(lucid, reclaimConfig2);

  expect(reclaimUnsigned2.type).toBe("error");
});
