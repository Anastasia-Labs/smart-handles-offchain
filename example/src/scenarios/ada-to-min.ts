import {
  batchRequest,
  BatchRequestConfig,
  Blockfrost,
  Lucid,
  toUnit,
  batchRoute,
  getBatchVAs,
  BatchVAs,
  errorToString,
  registerRewardAddress,
} from "@anastasia-labs/smart-handles-offchain";
import { MIN_SYMBOL_PREPROD, MIN_TOKEN_NAME } from "../constants.js";
import {
  fetchUsersBatchRequestUTxOs,
  mkBatchRequestConfig,
  mkBatchRouteConfig,
  signAndSubmitTxRes,
} from "../minswap-v1.js";
import { MinswapV1RequestUTxO } from "../types.js";

export const run = async (
  blockfrostKey: string,
  seedPhrase: string,
  routingAgentsSeedPhrase: string
): Promise<Error | void> => {
  try {
    const lucid = await Lucid(
      new Blockfrost(
        "https://cardano-preprod.blockfrost.io/api/v0",
        blockfrostKey
      ),
      "Preprod"
    );

    lucid.selectWallet.fromSeed(seedPhrase);

    const userAddress = await lucid.wallet().address();

    const requestConfigRes = await mkBatchRequestConfig(
      userAddress,
      [50_000_000, 100_000_000, 150_000_000, 200_000_000, 250_000_000].map(
        (l) => ({
          fromAsset: "lovelace",
          quantity: BigInt(l),
          toAsset: toUnit(MIN_SYMBOL_PREPROD, MIN_TOKEN_NAME),
          slippageTolerance: 99n,
        })
      ),
      "Preprod"
    );

    if (requestConfigRes.type == "error") return requestConfigRes.error;

    const requestConfig: BatchRequestConfig = requestConfigRes.data;

    const requestTxUnsignedRes = await batchRequest(lucid, requestConfig);

    console.log("Submitting the swap requests...");
    const requestTxHash = await signAndSubmitTxRes(lucid, requestTxUnsignedRes);
    console.log(`Request Successfully Submitted: ${requestTxHash}`);

    // --- REWARD ADDRESS REGISTRATION -----------------------------------------
    // // Commented out as the Minswap version of the smart handles contract is
    // // already registered on preprod.
    // const batchVAs: BatchVAs = getBatchVAs(
    //   requestConfig.stakingScriptCBOR,
    //   "Preprod"
    // );
    // const rewardAddress = batchVAs.stakeVA.address;
    // console.log("Registering the staking validator...");
    // await registerRewardAddress(lucid, rewardAddress);
    // console.log(`Staking validator successfully registered: ${rewardAddress}`);
    // -------------------------------------------------------------------------

    lucid.selectWallet.fromSeed(routingAgentsSeedPhrase);
    console.log("(switched to the routing agent's wallet)");

    console.log("Fetching user's batch requests...");
    const usersRequestsRes = await fetchUsersBatchRequestUTxOs(
      lucid,
      userAddress
    );
    if (usersRequestsRes.type == "error") return usersRequestsRes.error;
    const usersRequests: MinswapV1RequestUTxO[] = usersRequestsRes.data.slice(
      0,
      5
    );
    console.log(usersRequests);

    const batchRouteConfigRes = mkBatchRouteConfig(
      usersRequests.map((u) => u.outRef),
      "Preprod"
    );

    if (batchRouteConfigRes.type == "error") return batchRouteConfigRes.error;

    const swapTxUnsigned = await batchRoute(lucid, batchRouteConfigRes.data);

    console.log("Submitting the swap transaction...");
    const swapTxHash = await signAndSubmitTxRes(lucid, swapTxUnsigned);
    console.log(`Swap successfully performed: ${swapTxHash}`);
  } catch (e) {
    return new Error(errorToString(e));
  }
};
