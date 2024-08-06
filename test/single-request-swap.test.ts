import {
  Emulator,
  Lucid,
  SingleRequestConfig,
  SingleReclaimConfig,
  singleRequest,
  fetchUsersSingleRequestUTxOs,
  singleReclaim,
  SingleSwapConfig,
  singleSwap,
  MIN_SYMBOL_PREPROD,
  MIN_TOKEN_NAME,
  ADA_MIN_LP_TOKEN_NAME_PREPROD,
  toUnit,
} from "../src/index.js";
import { LucidContext, createUser } from "./utils.js";
import { beforeEach, expect, test } from "vitest";

//NOTE: INITIALIZE EMULATOR + ACCOUNTS
beforeEach<LucidContext>(async (context) => {
  context.users = {
    router: createUser(),
    user: createUser(),
    adversary: createUser(),
  };

  context.emulator = new Emulator([
    context.users.router,
    context.users.user,
    context.users.adversary,
  ]);

  context.lucid = await Lucid(context.emulator, "Custom");
});

const ciEnv = process.env.NODE_ENV === "CI";

// Avoid running the test in CI due to requirement for a Blockfrost key.
test.skipIf(ciEnv)<LucidContext>(
  "Test - Single Request, Swap",
  async ({ lucid, users, emulator }) => {
    const requestConfig: SingleRequestConfig = {
      swapRequest: {
        fromAsset: "lovelace",
        quantity: BigInt(50_000_000),
        toAsset: toUnit(MIN_SYMBOL_PREPROD, MIN_TOKEN_NAME),
      },
      network: "Custom",
    };

    lucid.selectWallet.fromSeed(users.user.seedPhrase);

    // Swap Request
    const requestUnsigned = await singleRequest(lucid, requestConfig);
    expect(requestUnsigned.type).toBe("ok");
    if (requestUnsigned.type == "ok") {
      const requestSigned = await requestUnsigned.data.sign
        .withWallet()
        .complete();
      const requestTxHash = await requestSigned.submit();
      // console.log("SWAP REQUEST TX HASH", requestTxHash);
    }

    emulator.awaitBlock(100);

    const userRequests = await fetchUsersSingleRequestUTxOs(
      lucid,
      users.user.address,
      "Custom",
    );

    // Invalid reclaim by adversary
    lucid.selectWallet.fromSeed(users.adversary.seedPhrase);

    const reclaimConfig: SingleReclaimConfig = {
      requestOutRef: userRequests[0].outRef,
      network: "Custom",
    };
    const invalidReclaim = await singleReclaim(lucid, reclaimConfig);

    expect(invalidReclaim.type).toBe("error");

    if (invalidReclaim.type == "ok") return;

    // console.log("Invalid Reclaim by Adversary");
    // console.log(`Failed. Response: ${invalidReclaim.error}`);

    // Valid Swap
    lucid.selectWallet.fromSeed(users.router.seedPhrase);

    const blockfrostKey = process.env.BLOCKFROST_KEY;

    if (!blockfrostKey) throw new Error("No Blockfrost API key was found");

    const swapConfig: SingleSwapConfig = {
      swapConfig: {
        blockfrostKey,
        poolId: ADA_MIN_LP_TOKEN_NAME_PREPROD,
        slippageTolerance: BigInt(20), // TODO?
      },
      requestOutRef: userRequests[0].outRef,
      network: "Custom",
    };

    const swapTxUnsigned = await singleSwap(lucid, swapConfig);

    if (swapTxUnsigned.type == "error") {
      console.log("SINGLE SWAP FAILED", swapTxUnsigned.error);
    }

    expect(swapTxUnsigned.type).toBe("ok");

    if (swapTxUnsigned.type == "ok") {
      const swapTxSigned = await swapTxUnsigned.data.sign.withWallet().complete();
      const swapTxHash = await swapTxSigned.submit();
      // console.log("SWAP TX HASH", swapTxHash);
    }
  }
);
