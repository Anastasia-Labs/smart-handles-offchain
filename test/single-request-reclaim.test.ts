import {
  Emulator,
  Lucid,
  SingleReclaimConfig,
  singleRequest,
  singleReclaim,
  toUnit,
  paymentCredentialOf,
} from "../src/index.js";
import { beforeEach, expect, test } from "vitest";
import { LucidContext, createUser } from "./utils.js";
import {
  fetchUsersSingleRequestUTxOs,
  mkSingleReclaimConfig,
  mkSingleRequestConfig,
} from "../example/src/minswap-v1.js";
import {
  MIN_SYMBOL_PREPROD,
  MIN_TOKEN_NAME,
} from "../example/src/constants.js";

//NOTE: INITIALIZE EMULATOR + ACCOUNTS
beforeEach<LucidContext>(async (context) => {
  context.users = {
    user1: createUser(),
    user2: createUser(),
  };

  context.emulator = new Emulator([context.users.user1, context.users.user2]);

  context.lucid = await Lucid(context.emulator, "Custom");
});

test<LucidContext>("Test - Request Single Swap, Reclaim", async ({
  lucid,
  users,
  emulator,
}) => {
  const requestConfigRes = await mkSingleRequestConfig(
    {
      fromAsset: "lovelace",
      quantity: BigInt(50_000_000),
      toAsset: toUnit(MIN_SYMBOL_PREPROD, MIN_TOKEN_NAME),
    },
    "Custom"
  );

  if (requestConfigRes.type == "error") throw requestConfigRes.error;

  const requestConfig = requestConfigRes.data;

  lucid.selectWallet.fromSeed(users.user1.seedPhrase);

  // NOTE: Singular Swap Request 1
  const requestUnsigned = await singleRequest(lucid, requestConfig);
  if (requestUnsigned.type == "error") {
    console.log("================ SINGLE REQUEST FAILED ===============");
    console.log(requestUnsigned.error);
  }

  expect(requestUnsigned.type).toBe("ok");
  if (requestUnsigned.type == "ok") {
    // console.log(requestUnsigned.data.txComplete.to_json());
    const requestSigned = await requestUnsigned.data.sign
      .withWallet()
      .complete();
    console.log("SINGLE REQUEST TX:", requestSigned.toCBOR());
    const requestTxHash = await requestSigned.submit();
    console.log("SINGLE REQUEST TX HASH:", requestTxHash);
  }

  emulator.awaitBlock(100);

  // NOTE: Swap Request 1
  const userRequests1Res = await fetchUsersSingleRequestUTxOs(
    lucid,
    users.user1.address,
  );

  if (userRequests1Res.type == "error") throw userRequests1Res.error;
  const userRequests1 = userRequests1Res.data;

  console.log(
    "REQUESTS OF USER WITH PAYMENT CRED. OF:",
    paymentCredentialOf(users.user1.address)
  );
  console.log(userRequests1);
  // console.log("user1 Requests", userRequests1);
  // console.log(
  //   "utxos at user1 wallet",
  //   await lucid.utxosAt(users.user1.address)
  // );

  const reclaimConfigRes = mkSingleReclaimConfig(
    userRequests1[0].outRef,
    "Custom"
  );
  if (reclaimConfigRes.type == "error") throw reclaimConfigRes.error;
  const reclaimConfig: SingleReclaimConfig = reclaimConfigRes.data;

  // NOTE: Invalid Reclaim 1
  lucid.selectWallet.fromSeed(users.user2.seedPhrase);
  const invalidReclaim = await singleReclaim(lucid, reclaimConfig);

  if (invalidReclaim.type == "ok") {
    console.log(invalidReclaim.data.toCBOR());
  }

  expect(invalidReclaim.type).toBe("error");

  // console.log("Invalid Reclaim 1");
  // console.log(`Failed. Response: ${invalidReclaim.error}`);

  // NOTE: Valid Reclaim 1
  lucid.selectWallet.fromSeed(users.user1.seedPhrase);
  const reclaimUnsigned1 = await singleReclaim(lucid, reclaimConfig);

  if (reclaimUnsigned1.type == "error") {
    console.log("================ SINGLE RECLAIM FAILED ===============");
    console.log(reclaimUnsigned1.error);
  }

  expect(reclaimUnsigned1.type).toBe("ok");

  // Typescript seems to be confused without this check.
  if (reclaimUnsigned1.type == "ok") {
    const reclaimSigned1 = await reclaimUnsigned1.data.sign
      .withWallet()
      .complete();
    const reclaimSignedHash1 = await reclaimSigned1.submit();
  }
}, 60_000);
