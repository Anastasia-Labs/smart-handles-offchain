import {
  Emulator,
  Lucid,
  singleReclaim,
  paymentCredentialOf,
} from "../src/index.js";
import { beforeEach, expect, test } from "vitest";
import {
  LucidContext,
  createUser,
  submitAdaToMinSingleRequest,
  unsafeFromOk,
} from "./utils.js";
import {
  fetchUsersSingleRequestUTxOs,
  mkSingleReclaimConfig,
} from "../example/src/minswap-v1.js";

//NOTE: INITIALIZE EMULATOR + ACCOUNTS
beforeEach<LucidContext>(async (context) => {
  context.users = {
    user1: createUser(),
    user2: createUser(),
  };

  context.emulator = new Emulator([context.users.user1, context.users.user2]);

  context.lucid = await Lucid(context.emulator, "Custom");
});

test<LucidContext>("Test - Single Request, Reclaim", async ({
  lucid,
  users,
  emulator,
}) => {
  await submitAdaToMinSingleRequest(emulator, lucid, users.user1.seedPhrase);

  const userRequests1 = unsafeFromOk(
    await fetchUsersSingleRequestUTxOs(lucid, users.user1.address)
  );

  console.log(
    "REQUESTS OF USER WITH PAYMENT CRED. OF:",
    paymentCredentialOf(users.user1.address)
  );
  console.log(userRequests1);

  const reclaimConfig = unsafeFromOk(
    mkSingleReclaimConfig(userRequests1[0].outRef, "Custom")
  );

  // NOTE: Invalid Reclaim 1
  lucid.selectWallet.fromSeed(users.user2.seedPhrase);
  const invalidReclaim = await singleReclaim(lucid, reclaimConfig);

  if (invalidReclaim.type == "ok") {
    console.log(invalidReclaim.data.toCBOR());
  }

  expect(invalidReclaim.type).toBe("error");

  // NOTE: Valid Reclaim 1
  lucid.selectWallet.fromSeed(users.user1.seedPhrase);
  const reclaimUnsigned1 = unsafeFromOk(
    await singleReclaim(lucid, reclaimConfig)
  );

  // Typescript seems to be confused without this check.
  const reclaimSigned1 = await reclaimUnsigned1.sign.withWallet().complete();
  const reclaimSignedHash1 = await reclaimSigned1.submit();
}, 60_000);
