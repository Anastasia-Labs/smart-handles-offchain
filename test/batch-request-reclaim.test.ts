import {
  Address,
  Emulator,
  Lucid,
  BatchRequestConfig,
  BatchReclaimConfig,
  batchRequest,
  fetchUsersBatchRequestUTxOs,
  batchReclaim,
  toUnit,
  MIN_SYMBOL_PREPROD,
  MIN_TOKEN_NAME,
  LucidEvolution,
} from "../src/index.js";
import { LucidContext, createUser, getWalletUTxOs, logWalletUTxOs } from "./utils.js";
import { beforeEach, expect, test } from "vitest";

//NOTE: INITIALIZE EMULATOR + ACCOUNTS
beforeEach<LucidContext>(async (context) => {
  context.users = {
    swapAccount: createUser(),
    user1: createUser(),
    user2: createUser(),
  };

  context.emulator = new Emulator([
    context.users.swapAccount,
    context.users.user1,
    context.users.user2,
  ]);

  context.lucid = await Lucid(context.emulator, "Custom");
});

const makeRequestConfig = (lovelaces: number[]): BatchRequestConfig => {
  return {
    swapRequests: lovelaces.map((l) => {
      return {
        fromAsset: "lovelace",
        quantity: BigInt(l),
        toAsset: toUnit(MIN_SYMBOL_PREPROD, MIN_TOKEN_NAME),
      };
    }),
    network: "Custom",
  };
};

const makeReclaimConfig = async (
  lucid: LucidEvolution,
  ownerAddr: Address
): Promise<BatchReclaimConfig> => {
  const userRequests = await fetchUsersBatchRequestUTxOs(
    lucid,
    ownerAddr,
    "Custom"
  );
  return {
    requestOutRefs: userRequests.map((u) => u.outRef),
    network: "Custom",
  };
};

test<LucidContext>("Test - Batch Swap Request, Reclaim", async ({
  lucid,
  users,
  emulator,
}) => {
  // Batch Swap Request
  lucid.selectWallet.fromSeed(users.user1.seedPhrase);

  const requestConfig: BatchRequestConfig = makeRequestConfig([
    8_000_000, 20_000_000, 30_000_000, 35_000_000,
  ]);

  const requestUnsigned1 = await batchRequest(lucid, requestConfig);

  if (requestUnsigned1.type == "error") {
    console.log("BATCH REQUEST FAILED", requestUnsigned1.error);
  }

  expect(requestUnsigned1.type).toBe("ok");

  if (requestUnsigned1.type == "ok") {
    const requestSigned1 = await requestUnsigned1.data.sign
      .withWallet()
      .complete();
    const requestTxHash1 = await requestSigned1.submit();
    console.log("BATCH REQUEST 1", requestUnsigned1);
    console.log("BATCH REQUEST 1 TX HASH", requestTxHash1);
  }

  emulator.awaitBlock(100);

  // const utxosAfterRequest = await getWalletUTxOs(lucid);
  // console.log("------------------------- AFTER REQUEST -------------------------");
  // console.log(utxosAfterRequest);

  // const unsignedCollateralTx = await lucid
  //   .newTx()
  //   .collectFrom(utxosAfterRequest)
  //   .pay.ToAddress(users.user1.address, { lovelace: BigInt(5_000_000) })
  //   .complete();

  // console.log("~~~~~~~~~~~~~~~~~~~~~ TX ~~~~~~~~~~~~~~~~~~~~~");
  // console.log(unsignedCollateralTx);

  // const signedCollateralTx = await unsignedCollateralTx.sign
  //   .withWallet()
  //   .complete();
  // const collateralTxHash = await signedCollateralTx.submit();

  // emulator.awaitBlock(100);

  // await logWalletUTxOs(lucid, "AFTER COLLATERAL");

  // Valid Batch Reclaim
  const reclaimConfig1: BatchReclaimConfig = await makeReclaimConfig(
    lucid,
    users.user1.address
  );

  const reclaimUnsigned1 = await batchReclaim(lucid, reclaimConfig1);

  if (reclaimUnsigned1.type == "error") {
    console.log("================ BATCH RECLAIM FAILED ================");
    console.log(reclaimUnsigned1.error);
  }

  expect(reclaimUnsigned1.type).toBe("ok");

  if (reclaimUnsigned1.type == "ok") {
    const reclaimSigned1 = await reclaimUnsigned1.data.sign
      .withWallet()
      .complete();
    const reclaimSignedHash1 = await reclaimSigned1.submit();
    // console.log("BATCH RECLAIM 1 TX HASH", reclaimSignedHash1);
  }

  emulator.awaitBlock(100);

  // Repeat Batch Request
  const requestUnsigned2 = await batchRequest(lucid, requestConfig);

  expect(requestUnsigned2.type).toBe("ok");

  if (requestUnsigned2.type == "ok") {
    const requestSigned2 = await requestUnsigned2.data.sign
      .withWallet()
      .complete();
    const requestTxHash2 = await requestSigned2.submit();
    // console.log("BATCH REQUEST 2 TX HASH", requestTxHash2);
  }

  emulator.awaitBlock(100);

  // Attempt Batch Reclaim of user1 UTxOs by user2
  lucid.selectWallet.fromSeed(users.user2.seedPhrase);
  const reclaimConfig2: BatchReclaimConfig = await makeReclaimConfig(
    lucid,
    users.user1.address
  );

  const reclaimUnsigned2 = await batchReclaim(lucid, reclaimConfig2);

  expect(reclaimUnsigned2.type).toBe("error");
});
