import {
  MIN_SYMBOL_PREPROD,
  MIN_TOKEN_NAME,
} from "../example/src/constants.js";
import {
  fetchUsersBatchRequestUTxOs,
  mkBatchReclaimConfig,
  mkBatchRequestConfig,
} from "../example/src/minswap-v1.js";
import {
  Emulator,
  Lucid,
  BatchRequestConfig,
  BatchReclaimConfig,
  batchRequest,
  batchReclaim,
  toUnit,
} from "../src/index.js";
import { LucidContext, createUser, unsafeFromOk } from "./utils.js";
import { beforeEach, expect, test } from "vitest";

//NOTE: INITIALIZE EMULATOR + ACCOUNTS
beforeEach<LucidContext>(async (context) => {
  context.users = {
    user1: createUser(),
    user2: createUser(),
  };

  context.emulator = new Emulator([context.users.user1, context.users.user2]);

  context.lucid = await Lucid(context.emulator, "Custom");
});

test<LucidContext>("Test - Batch Swap Request, Reclaim", async ({
  lucid,
  users,
  emulator,
}) => {
  // Batch Swap Request
  lucid.selectWallet.fromSeed(users.user1.seedPhrase);

  const requestConfig: BatchRequestConfig = unsafeFromOk(
    await mkBatchRequestConfig(
      [8_000_000, 20_000_000, 10_000_000, 25_000_000].map((qty) => {
        return {
          fromAsset: "lovelace",
          quantity: BigInt(qty),
          toAsset: toUnit(MIN_SYMBOL_PREPROD, MIN_TOKEN_NAME),
        };
      }),
      "Custom"
    )
  );

  const requestUnsigned1 = unsafeFromOk(
    await batchRequest(lucid, requestConfig)
  );

  const requestSigned1 = await requestUnsigned1.sign.withWallet().complete();
  const requestTxHash1 = await requestSigned1.submit();
  console.log("BATCH REQUEST 1", requestUnsigned1);
  console.log("BATCH REQUEST 1 TX HASH", requestTxHash1);

  emulator.awaitBlock(100);

  const user1Requests = unsafeFromOk(
    await fetchUsersBatchRequestUTxOs(lucid, users.user1.address)
  );

  // Valid Batch Reclaim
  const reclaimConfig1 = unsafeFromOk(
    mkBatchReclaimConfig(
      user1Requests.map((u) => u.outRef),
      "Custom"
    )
  );

  const reclaimUnsigned1 = unsafeFromOk(
    await batchReclaim(lucid, reclaimConfig1)
  );

  const reclaimSigned1 = await reclaimUnsigned1.sign.withWallet().complete();
  const reclaimSignedHash1 = await reclaimSigned1.submit();
  // console.log("BATCH RECLAIM 1 TX HASH", reclaimSignedHash1);

  emulator.awaitBlock(100);

  // Repeat Batch Request
  const requestUnsigned2 = unsafeFromOk(
    await batchRequest(lucid, requestConfig)
  );
  const requestSigned2 = await requestUnsigned2.sign.withWallet().complete();
  const requestTxHash2 = await requestSigned2.submit();
  console.log("BATCH REQUEST 2 TX HASH", requestTxHash2);

  emulator.awaitBlock(100);

  const user1Requests2 = unsafeFromOk(
    await fetchUsersBatchRequestUTxOs(lucid, users.user1.address)
  );

  // Attempt Batch Reclaim of user1 UTxOs by user2
  lucid.selectWallet.fromSeed(users.user2.seedPhrase);
  const reclaimConfig2: BatchReclaimConfig = unsafeFromOk(
    mkBatchReclaimConfig(
      user1Requests2.map((u) => u.outRef),
      "Custom"
    )
  );

  const reclaimUnsigned2 = await batchReclaim(lucid, reclaimConfig2);

  expect(reclaimUnsigned2.type).toBe("error");
});
