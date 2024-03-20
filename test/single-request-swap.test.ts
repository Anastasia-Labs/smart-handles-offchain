import {
  Emulator,
  Lucid,
  generateAccountSeedPhrase,
  SingleRequestConfig,
  SingleReclaimConfig,
  singleRequest,
  FetchUsersSingleRequestConfig,
  userSingleRequestUTxOs,
  singleReclaim,
  SingleSwapConfig,
  singleSwap,
} from "../src/index.js";
import { beforeEach, expect, test } from "vitest";
import spendingValidator from "./smartHandleSimple.json" assert { type : "json" };

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
    router: await createUser(),
    user: await createUser(),
    adversary: await createUser(),
  };

  context.emulator = new Emulator([
    context.users.router,
    context.users.user,
    context.users.adversary,
  ]);

  context.lucid = await Lucid.new(context.emulator);
});

test<LucidContext>("Test - Single Request, Swap", async ({
  lucid,
  users,
  emulator,
}) => {
  const requestConfig: SingleRequestConfig = {
    network: "Testnet",
    spendingScript: spendingValidator.cborHex,
    lovelace: BigInt(50_000_000),
  };

  lucid.selectWalletFromSeed(users.user.seedPhrase);

  // Swap Request
  const requestUnsigned = await singleRequest(lucid, requestConfig);
  expect(requestUnsigned.type).toBe("ok");
  if (requestUnsigned.type == "ok") {
    const requestSigned = await requestUnsigned.data.sign().complete();
    const requestTxHash = await requestSigned.submit();
    // console.log("SWAP REQUEST TX HASH", requestTxHash);
  }

  emulator.awaitBlock(100);

  const usersSingleRequestConfig: FetchUsersSingleRequestConfig = {
    owner: users.user.address,
    network: "Testnet",
    spendingScript: spendingValidator.cborHex,
  };

  const userRequests = await userSingleRequestUTxOs(
    lucid,
    usersSingleRequestConfig
  );

  // Invalid reclaim by adversary
  lucid.selectWalletFromSeed(users.adversary.seedPhrase);

  const reclaimConfig: SingleReclaimConfig = {
    requestOutRef: userRequests[0].outRef,
    network: "Testnet",
    spendingScript: spendingValidator.cborHex,
  };
  const invalidReclaim = await singleReclaim(lucid, reclaimConfig);

  expect(invalidReclaim.type).toBe("error");

  if (invalidReclaim.type == "ok") return;

  // console.log("Invalid Reclaim by Adversary");
  // console.log(`Failed. Response: ${invalidReclaim.error}`);

  // Valid Swap
  lucid.selectWalletFromSeed(users.router.seedPhrase);

  const blockfrostKey = process.env.BLOCKFROST_KEY;

  if (!blockfrostKey) throw new Error("No Blockfrost API key was found");

  const swapConfig: SingleSwapConfig = {
    swapConfig: {
      blockfrostKey,
      network: "Testnet",
      slippageTolerance: BigInt(20), // TODO?
    },
    requestOutRef: userRequests[0].outRef,
    spendingScript: spendingValidator.cborHex,
  };

  const swapTxUnsigned = await singleSwap(lucid, swapConfig);

  if (swapTxUnsigned.type == "error") {
    console.log("SINGLE SWAP FAILED", swapTxUnsigned.error);
  }

  expect(swapTxUnsigned.type).toBe("ok");

  if (swapTxUnsigned.type == "ok") {
    const swapTxSigned = await swapTxUnsigned.data.sign().complete();
    const swapTxHash = await swapTxSigned.submit();
    // console.log("SWAP TX HASH", swapTxHash);
  }
});
