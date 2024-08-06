import {
  Emulator,
  Lucid,
  SingleRequestConfig,
  SingleReclaimConfig,
  singleRequest,
  fetchUsersSingleRequestUTxOs,
  singleReclaim,
  toUnit,
  MIN_SYMBOL_PREPROD,
  MIN_TOKEN_NAME,
} from "../src/index.js";
import { beforeEach, expect, test } from "vitest";
import { LucidContext, createUser } from "./utils.js";

//NOTE: INITIALIZE EMULATOR + ACCOUNTS
beforeEach<LucidContext>(async (context) => {
  context.users = {
    swapAccount: createUser(),
    creator1: createUser(),
    creator2: createUser(),
  };

  context.emulator = new Emulator([
    context.users.swapAccount,
    context.users.creator1,
    context.users.creator2,
  ]);

  context.lucid = await Lucid(context.emulator, "Custom");
});

test<LucidContext>("Test - Request Single Swap, Reclaim", async ({
  lucid,
  users,
  emulator,
}) => {
  const requestConfig: SingleRequestConfig = {
    swapRequest: {
      fromAsset: "lovelace",
      quantity: BigInt(50_000_000),
      toAsset: toUnit(MIN_SYMBOL_PREPROD, MIN_TOKEN_NAME),
    },
    network: "Custom",
  };

  lucid.selectWallet.fromSeed(users.creator1.seedPhrase);

  // NOTE: Singular Swap Request 1
  const requestUnsigned = await singleRequest(lucid, requestConfig);
  // console.log("requestUnsigned", requestUnsigned);
  expect(requestUnsigned.type).toBe("ok");
  if (requestUnsigned.type == "ok") {
    // console.log(requestUnsigned.data.txComplete.to_json());
    const requestSigned = await requestUnsigned.data.sign
      .withWallet()
      .complete();
    const requestTxHash = await requestSigned.submit();
    // console.log(requestTxHash);
  }

  emulator.awaitBlock(100);

  // NOTE: Swap Request 1
  const userRequests1 = await fetchUsersSingleRequestUTxOs(
    lucid,
    users.creator1.address,
    "Custom",
  );

  // console.log("Request 1");
  // console.log("creator1 Requests", userRequests1);
  // console.log(
  //   "utxos at creator1 wallet",
  //   await lucid.utxosAt(users.creator1.address)
  // );

  const reclaimConfig: SingleReclaimConfig = {
    requestOutRef: userRequests1[0].outRef,
    network: "Custom",
  };

  // NOTE: Invalid Reclaim 1
  lucid.selectWallet.fromSeed(users.creator2.seedPhrase);
  const invalidReclaim = await singleReclaim(lucid, reclaimConfig);

  expect(invalidReclaim.type).toBe("error");

  if (invalidReclaim.type == "ok") return;

  // console.log("Invalid Reclaim 1");
  // console.log(`Failed. Response: ${invalidReclaim.error}`);

  // NOTE: Valid Reclaim 1
  lucid.selectWallet.fromSeed(users.creator1.seedPhrase);
  const reclaimUnsigned1 = await singleReclaim(lucid, reclaimConfig);

  if (reclaimUnsigned1.type == "error") {
    console.log("================ SINGLE RECLAIM FAILED ===============");
    console.log(reclaimUnsigned1.error);
  }

  expect(reclaimUnsigned1.type).toBe("ok");

  const reclaimSigned1 = await reclaimUnsigned1.data.sign
    .withWallet()
    .complete();
  const reclaimSignedHash1 = await reclaimSigned1.submit();
});
