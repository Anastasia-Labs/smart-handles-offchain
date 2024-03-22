import {
  Address,
  Emulator,
  Lucid,
  generateAccountSeedPhrase,
  BatchRequestConfig,
  batchRequest,
  FetchBatchRequestConfig,
  getBatchRequestUTxOs,
  BatchSwapConfig,
  batchSwap,
  WithdrawalValidator,
  PROTOCOL_PARAMETERS_DEFAULT,
  getBatchVAs,
  BatchVAs,
  LimitedNetwork,
} from "../src/index.js";
import { beforeEach, expect, test } from "vitest";
import spendingValidator from "./smartHandleRouter.json" assert { type : "json" };
import stakingValidator from "./smartHandleStake.json" assert { type : "json" };

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
    user1: await createUser(),
    user2: await createUser(),
    user3: await createUser(),
    user4: await createUser(),
    adversary: await createUser(),
  };

  context.emulator = new Emulator(
    [
      context.users.router,
      context.users.user1,
      context.users.user2,
      context.users.user3,
      context.users.user4,
      context.users.adversary,
    ],
    {
      ...PROTOCOL_PARAMETERS_DEFAULT,
      maxTxSize: 1000000,
      maxTxExMem: BigInt(140000000),
      maxTxExSteps: BigInt(100000000000),
    }
  );

  context.lucid = await Lucid.new(context.emulator);
});

const unAppliedScripts = {
  spending: spendingValidator.cborHex,
  staking: stakingValidator.cborHex,
};

const makeRequestConfig = (
  network: LimitedNetwork,
  ownerAddr: Address,
  lovelaces: number[]
): BatchRequestConfig => {
  return {
    network,
    owner: ownerAddr,
    lovelaces: lovelaces.map(BigInt),
    scripts: unAppliedScripts,
  };
};

const makeAndSubmitRequest = async (
  lucid: Lucid,
  emulator: Emulator,
  network: LimitedNetwork,
  userSeedPhrase: string,
  userAddress: Address,
  lovelaces: number[]
) => {
  // Batch Swap Request
  lucid.selectWalletFromSeed(userSeedPhrase);

  const requestConfig: BatchRequestConfig = makeRequestConfig(
    network,
    userAddress,
    lovelaces
  );

  const requestUnsigned = await batchRequest(lucid, requestConfig);

  if (requestUnsigned.type == "error") {
    console.log("BATCH SWAP REQUEST FAILED", requestUnsigned.error);
  }

  expect(requestUnsigned.type).toBe("ok");

  if (requestUnsigned.type == "ok") {
    const requestSigned = await requestUnsigned.data.sign().complete();
    const requestTxHash = await requestSigned.submit();
    // console.log("BATCH REQUEST 1 TX HASH", requestTxHash1);
  }

  emulator.awaitBlock(100);
};

async function registerRewardAddress(
  lucid: Lucid,
  rewardAddress: string
): Promise<void> {
  const tx = await lucid.newTx().registerStake(rewardAddress).complete();
  const signedTx = await tx.sign().complete();
  await signedTx.submit();
}

test<LucidContext>("Test - Batch Request, Swap", async ({
  lucid,
  users,
  emulator,
}) => {
  console.log("MAX CPU", emulator.protocolParameters.maxTxExSteps);
  console.log("MAX MEM", emulator.protocolParameters.maxTxExMem);
  const batchVAsRes = getBatchVAs(
    lucid,
    "Testnet",
    unAppliedScripts
  );

  if (batchVAsRes.type == "error") return batchVAsRes;

  const batchVAs: BatchVAs = batchVAsRes.data;

  // User1 Batch Swap Request
  await makeAndSubmitRequest(
    lucid,
    emulator,
    "Testnet",
    users.user1.seedPhrase,
    users.user1.address,
    [5_000_000, 20_000_000, 30_000_000, 40_000_000]
  );
  // User2 Batch Swap Request
  await makeAndSubmitRequest(
    lucid,
    emulator,
    "Testnet",
    users.user2.seedPhrase,
    users.user2.address,
    [30_000_000, 36_000_000, 24_000_000]
  );
  // // User3 Batch Swap Request
  // await makeAndSubmitRequest(
  //   lucid,
  //   emulator,
  //   "Testnet",
  //   users.user3.seedPhrase,
  //   users.user3.address,
  //   [10_000_000, 72_000_000]
  // );
  // // User4 Batch Swap Request
  // await makeAndSubmitRequest(
  //   lucid,
  //   emulator,
  //   "Testnet",
  //   users.user4.seedPhrase,
  //   users.user4.address,
  //   [
  //     5_000_000, 10_000_000, 7_000_000, 4_000_000, 3_000_000, 3_400_000,
  //     6_800_000,
  //   ]
  // );

  const batchRequestConfig: FetchBatchRequestConfig = {
    network: "Testnet",
    scripts: unAppliedScripts,
  };

  const allRequests = await getBatchRequestUTxOs(lucid, batchRequestConfig);

  // Valid Swap
  lucid.selectWalletFromSeed(users.router.seedPhrase);

  // Register Staking Validator's Reward Address
  const rewardAddress = batchVAs.stakeVA.address;
  await registerRewardAddress(lucid, rewardAddress);

  emulator.awaitBlock(100);

  const blockfrostKey = process.env.BLOCKFROST_KEY;

  if (!blockfrostKey) throw new Error("No Blockfrost API key was found");

  // Specifying constant `minReceive` for all requests. TODO.
  const swapConfig: BatchSwapConfig = {
    swapConfig: {
      blockfrostKey,
      network: "Testnet",
      slippageTolerance: BigInt(20), // TODO?
    },
    requestOutRefs: allRequests.map(u => u.outRef),
    scripts: unAppliedScripts,
  };

  const swapTxUnsigned = await batchSwap(lucid, swapConfig);

  if (swapTxUnsigned.type == "error") {
    console.log("BATCH SWAP FAILED", swapTxUnsigned.error);
  }

  expect(swapTxUnsigned.type).toBe("ok");

  if (swapTxUnsigned.type == "ok") {
    const swapTxSigned = await swapTxUnsigned.data.sign().complete();
    console.log("SIGNED TX", swapTxSigned);
    const swapTxHash = await swapTxSigned.submit();
    // console.log("SWAP TX HASH", swapTxHash);
  }
});
