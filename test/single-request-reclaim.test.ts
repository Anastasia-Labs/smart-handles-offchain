import {
  Emulator,
  Lucid,
  generateAccountSeedPhrase,
  SingleRequestConfig,
  SingleReclaimConfig,
  singleRequest,
  fetchUsersSingleRequestUTxOs,
  singleReclaim,
} from "../src/index.js";
import { beforeEach, expect, test } from "vitest";

type LucidContext = {
  lucid: Lucid;
  users: any;
  emulator: Emulator;
};

//NOTE: INITIALIZE EMULATOR + ACCOUNTS
beforeEach<LucidContext>(async (context) => {
  context.users = {
    swapAccount: await generateAccountSeedPhrase({
      lovelace: BigInt(100_000_000),
    }),
    creator1: await generateAccountSeedPhrase({
      lovelace: BigInt(100_000_000),
    }),
    creator2: await generateAccountSeedPhrase({
      lovelace: BigInt(100_000_000),
    }),
  };

  context.emulator = new Emulator([
    context.users.swapAccount,
    context.users.creator1,
    context.users.creator2,
  ]);

  context.lucid = await Lucid.new(context.emulator);
});

test<LucidContext>("Test - Request Single Swap, Reclaim", async ({
  lucid,
  users,
  emulator,
}) => {
  const requestConfig: SingleRequestConfig = {
    lovelace: BigInt(50_000_000),
    testnet: true,
  };

  lucid.selectWalletFromSeed(users.creator1.seedPhrase);

  // NOTE: Singular Swap Request 1
  const requestUnsigned = await singleRequest(lucid, requestConfig);
  // console.log("requestUnsigned", requestUnsigned);
  expect(requestUnsigned.type).toBe("ok");
  if (requestUnsigned.type == "ok") {
    // console.log(requestUnsigned.data.txComplete.to_json());
    const requestSigned = await requestUnsigned.data.sign().complete();
    const requestTxHash = await requestSigned.submit();
    // console.log(requestTxHash);
  }

  emulator.awaitBlock(100);

  // NOTE: Swap Request 1
  const userRequests1 = await fetchUsersSingleRequestUTxOs(
    lucid,
    users.creator1.address,
    true
  );

  // console.log("Request 1");
  // console.log("creator1 Requests", userRequests1);
  // console.log(
  //   "utxos at creator1 wallet",
  //   await lucid.utxosAt(users.creator1.address)
  // );

  const reclaimConfig: SingleReclaimConfig = {
    requestOutRef: userRequests1[0].outRef,
    testnet: true,
  };

  // NOTE: Invalid Reclaim 1
  lucid.selectWalletFromSeed(users.creator2.seedPhrase);
  const invalidReclaim = await singleReclaim(lucid, reclaimConfig);

  expect(invalidReclaim.type).toBe("error");

  if (invalidReclaim.type == "ok") return;

  // console.log("Invalid Reclaim 1");
  // console.log(`Failed. Response: ${invalidReclaim.error}`);

  // NOTE: Valid Reclaim 1
  lucid.selectWalletFromSeed(users.creator1.seedPhrase);
  const reclaimUnsigned1 = await singleReclaim(lucid, reclaimConfig);

  // console.log(reclaimUnsigned1);
  expect(reclaimUnsigned1.type).toBe("ok");

  if (reclaimUnsigned1.type == "error") {
    // console.log(reclaimUnsigned1.error);
    return;
  }
  const reclaimSigned1 = await reclaimUnsigned1.data.sign().complete();
  const reclaimSignedHash1 = await reclaimSigned1.submit();
});
