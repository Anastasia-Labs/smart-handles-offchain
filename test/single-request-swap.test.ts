import {
  fetchUsersSingleRequestUTxOs,
  mkSingleReclaimConfig,
  mkSingleRouteConfig,
} from "../example/src/minswap-v1.js";
import { Emulator, Lucid, singleReclaim, singleRoute } from "../src/index.js";
import {
  LucidContext,
  createUser,
  submitAdaToMinRequest,
  unsafeFromOk,
} from "./utils.js";
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
    await submitAdaToMinRequest(emulator, lucid, users.user.seedPhrase);

    const userRequests = unsafeFromOk(
      await fetchUsersSingleRequestUTxOs(lucid, users.user.address)
    );

    // Invalid reclaim by adversary
    lucid.selectWallet.fromSeed(users.adversary.seedPhrase);
    const reclaimConfig = unsafeFromOk(
      mkSingleReclaimConfig(userRequests[0].outRef, "Custom")
    );
    const invalidReclaim = await singleReclaim(lucid, reclaimConfig);
    expect(invalidReclaim.type).toBe("error");

    // Valid Swap
    lucid.selectWallet.fromSeed(users.router.seedPhrase);
    const routeConfig = unsafeFromOk(
      await mkSingleRouteConfig(BigInt(20), userRequests[0].outRef, "Custom")
    );

    const swapTxUnsigned = unsafeFromOk(await singleRoute(lucid, routeConfig));
    const swapTxSigned = await swapTxUnsigned.sign.withWallet().complete();
    const swapTxHash = await swapTxSigned.submit();
    // console.log("SWAP TX HASH", swapTxHash);
  }
);
