import {
  Emulator,
  Lucid,
  singleReclaim,
  paymentCredentialOf,
  PROTOCOL_PARAMETERS_DEFAULT,
} from "@anastasia-labs/smart-handles-offchain";
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
} from "../src/minswap-v1.js";

//NOTE: INITIALIZE EMULATOR + ACCOUNTS
beforeEach<LucidContext>(async (context) => {
  context.users = {
    user1: createUser(),
    user2: createUser(),
  };
  context.emulator = new Emulator(
    [context.users.user1, context.users.user2],
    {
      ...PROTOCOL_PARAMETERS_DEFAULT,
      maxTxSize: 10000000,
    }
  );

  context.lucid = await Lucid(context.emulator, "Custom");
});

test<LucidContext>("Test - Single Request, Reclaim", async ({
  lucid,
  users,
  emulator,
}) => {
  await submitAdaToMinSingleRequest(emulator, lucid, users.user1.seedPhrase);

  const userRequests1 = unsafeFromOk(
    await fetchUsersSingleRequestUTxOs("Custom", lucid, users.user1.address)
  );

  console.log(
    "REQUESTS OF USER WITH PAYMENT CRED. OF:",
    paymentCredentialOf(users.user1.address)
  );
  console.log(userRequests1);

  // NOTE: Invalid Reclaim 1
  lucid.selectWallet.fromSeed(users.user2.seedPhrase);
  const user2ReclaimConfig = unsafeFromOk(
    mkSingleReclaimConfig(
      userRequests1[0].outRef,
      "Custom"
    )
  );
  const invalidReclaim = await singleReclaim(lucid, user2ReclaimConfig);

  if (invalidReclaim.type == "ok") {
    console.log(invalidReclaim.data.toCBOR());
  }

  expect(invalidReclaim.type).toBe("error");

  // NOTE: Valid Reclaim 1
  lucid.selectWallet.fromSeed(users.user1.seedPhrase);
  const user1ReclaimConfig = unsafeFromOk(
    mkSingleReclaimConfig(
      userRequests1[0].outRef,
      "Custom"
    )
  );
  console.log("VALID RECLAIM CONFIG");
  console.log(user1ReclaimConfig);
  const reclaimUnsigned1 = unsafeFromOk(
    await singleReclaim(lucid, user1ReclaimConfig)
  );
  console.log("VALID RECLAIM TX UNSIGNED");
  console.log(reclaimUnsigned1.toCBOR());

  // Typescript seems to be confused without this check.
  const reclaimSigned1 = await reclaimUnsigned1.sign.withWallet().complete();
  console.log("VALID RECLAIM TX SIGNED");
  console.log(reclaimSigned1.toCBOR());
  try {
    const reclaimSignedHash1 = await reclaimSigned1.submit();
  } catch (e) {
    console.log(JSON.stringify(e));
    throw e;
  }
}, 60_000);
