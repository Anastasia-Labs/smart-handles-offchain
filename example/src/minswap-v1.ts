// IMPORTS --------------------------------------------------------------------
// {{{
import { BlockFrostAPI } from "@blockfrost/blockfrost-js";
import {
  Asset as MinswapAsset,
  BlockfrostAdapter,
  PoolState,
  calculateSwapExactIn,
} from "@minswap/sdk";
import {
  Address,
  AdvancedDatumFields,
  AdvancedReclaimConfig,
  AdvancedRouteRequest,
  Asset,
  Assets,
  BatchReclaimConfig,
  BatchRequestConfig,
  BatchRouteConfig,
  CBORHex,
  Data,
  LucidEvolution,
  Network,
  OutRef,
  OutputDatum,
  OutputDatumMaker,
  ROUTER_FEE,
  ReclaimConfig,
  Result,
  RouteConfig,
  RouteRequest,
  SingleReclaimConfig,
  SingleRequestConfig,
  SingleRouteConfig,
  SmartHandleDatum,
  UTxO,
  Unit,
  applyParamsToScript,
  collectErrorMsgs,
  errorToString,
  fetchBatchRequestUTxOs,
  fetchSingleRequestOutRefs,
  fromAddress,
  fromAddressToData,
  fromUnit,
  genericCatch,
  ok,
  parseAdvancedDatum,
  parseSafeDatum,
  toAddress,
  validateItems,
} from "../../src/index.js";
import {
  MinswapRequestInfo,
  MinswapV1RequestUTxO,
  OrderDatum,
  OrderType,
} from "./types.js";
import {
  MINSWAP_ADDRESS_MAINNET,
  MINSWAP_ADDRESS_PREPROD,
  MINSWAP_BATCHER_FEE,
  MINSWAP_DEPOSIT,
} from "./constants.js";
import singleSpendingValidator from "./uplc/smartHandleSimple.json";
import stakingValidator from "./uplc/smartHandleStake.json";
// }}}
// ----------------------------------------------------------------------------

// UTILITY FUNCTIONS ----------------------------------------------------------
// {{{
const applyMinswapAddressToCBOR = (
  cbor: string,
  network: Network
): Result<string> => {
  // {{{
  const addressRes = fromAddressToData(
    network === "Mainnet" ? MINSWAP_ADDRESS_MAINNET : MINSWAP_ADDRESS_PREPROD
  );
  if (addressRes.type == "error") return addressRes;
  return {
    type: "ok",
    data: applyParamsToScript(cbor, [addressRes.data]),
  };
  // }}}
};

const CACHE_REFETCH_THRESHOLD = 600000;
let CACHED_POOL_STATES: PoolState[] = [];
let pool_states_cache_date = new Date(0);

/*
 * Practice EXTREME CAUTION here: this function is quite expensive, and
 * therefore leverages a memory-based caching mechanism that expires after ten
 * minutes (although it doesn't refetch unless a sought pool is not found). The
 * cache is stored in the module-wide variable `CACHED_POOL_STATES`, while its
 * last cache `Date` is stored in `pool_states_cache_date`.
 * */
const getPoolStateFromAssets = async (
  blockfrostAdapter: BlockfrostAdapter,
  assetA: Unit,
  assetB: Unit
): Promise<Result<PoolState>> => {
  // {{{
  const allPools: PoolState[] = [];
  if (CACHED_POOL_STATES.length > 0) {
    // If a cache exists, reuse it.
    allPools.push(...CACHED_POOL_STATES);
  } else {
    // Pages 0 and 1 seem to be identical, hence starting with `i = 1`
    let i = 1;
    while (true) {
      try {
        const pools = await blockfrostAdapter.getPools({ page: i });
        if (pools.length <= 0) {
          break;
        } else {
          allPools.push(...pools);
          i++;
        }
      } catch (e) {
        return genericCatch(e);
      }
    }
    CACHED_POOL_STATES = [...allPools];
    pool_states_cache_date = new Date();
  }
  const filteredPools = allPools.filter((p) => {
    const aIsA = p.assetA == assetA;
    const aIsB = p.assetA == assetB;
    const bIsA = p.assetB == assetA;
    const bIsB = p.assetB == assetB;
    return (aIsA && bIsB) || (aIsB && bIsA);
  });
  if (filteredPools.length == 1) {
    const poolState = filteredPools[0];
    // const poolIdValue = poolState.value.find(
    //   (v) =>
    //     v.unit != "lovelace" &&
    //     v.unit != assetA &&
    //     v.unit != assetB &&
    //     v.unit.length == 120
    // );
    return {
      type: "ok",
      data: poolState,
    };
  } else {
    const curr_date = new Date();
    if (
      curr_date.getTime() - pool_states_cache_date.getTime() <
      CACHE_REFETCH_THRESHOLD
    ) {
      // If stored cache is old, empty it and recall this function.
      CACHED_POOL_STATES = [];
      const res = await getPoolStateFromAssets(
        blockfrostAdapter,
        assetA,
        assetB
      );
      return res;
    } else {
      return {
        type: "error",
        error: new Error("Pool ID not found"),
      };
    }
  }
  // }}}
};

/**
 * Helper function for constructing the proper datum expected by Minswap's
 * script address.
 * @param asset - Policy ID and token name of the desired token
 * @param ownerAddress - Address of the owner extracted from the input `SmartHandleDatum`
 * @param minimumReceived - Minimum amount of tokens the owner should receive
 */
const makeOrderDatum = (
  asset: MinswapAsset,
  ownerAddress: Address,
  minimumReceived: bigint
): OrderDatum => {
  // {{{
  const addr = fromAddress(ownerAddress);
  const desiredAsset = {
    symbol: asset.policyId,
    name: asset.tokenName,
  };
  const orderType: OrderType = {
    desiredAsset,
    minReceive: minimumReceived,
  };
  return {
    sender: addr,
    receiver: addr,
    receiverDatumHash: null,
    step: orderType,
    batcherFee: MINSWAP_BATCHER_FEE,
    depositADA: MINSWAP_DEPOSIT,
  };
  // }}}
};

export type SwapRequest = {
  fromAsset: Asset;
  quantity: bigint;
  toAsset: Asset;
};

/**
 * Helper function for creating a `RouteRequest` for a swap request. `Asset` is
 * identical to "unit," i.e. concatenation of asset's policy with its token name
 * in hex format.
 *
 * This function uses Blockfrost to determine the exchange rate, and stores it
 * in the `minimumReceive` field of `extraInfo`.
 *
 * @param swapRequest - Consists of 3 fields:
 *   - fromAsset: Unit of the asset A to be converted
 *   - quantity: Amount of asset A
 *   - toAsset: Unit of desired asset B
 * @param network - Target network
 */
const mkRouteRequest = async (
  { fromAsset, quantity, toAsset }: SwapRequest,
  network: Network
): Promise<Result<RouteRequest>> => {
  // {{{
  const minLovelaces = MINSWAP_BATCHER_FEE + MINSWAP_DEPOSIT + ROUTER_FEE;
  const valueToLock =
    fromAsset === "lovelace"
      ? {
          lovelace: minLovelaces + quantity,
        }
      : {
          lovelace: minLovelaces,
          [fromAsset]: quantity,
        };

  const blockfrostKey = process.env.BLOCKFROST_KEY;
  if (!blockfrostKey)
    return {
      type: "error",
      error: new Error("No Blockfrost API key was found"),
    };
  const blockfrostAdapter = new BlockfrostAdapter({
    blockFrost: new BlockFrostAPI({
      projectId: blockfrostKey,
      network: network === "Mainnet" ? "mainnet" : "preprod",
    }),
  });
  const poolStateRes = await getPoolStateFromAssets(
    blockfrostAdapter,
    fromAsset,
    toAsset
  );
  if (poolStateRes.type == "error") return poolStateRes;
  const poolState = poolStateRes.data;

  const { amountOut } = calculateSwapExactIn({
    amountIn: quantity,
    reserveIn: poolState.reserveA,
    reserveOut: poolState.reserveB,
  });

  const { policyId, assetName } =
    toAsset === "" ? { policyId: "", assetName: "" } : fromUnit(toAsset);
  const advancedRouteRequest: AdvancedRouteRequest = {
    valueToLock,
    markWalletAsOwner: true,
    routerFee: ROUTER_FEE,
    reclaimRouterFee: 0n,
    extraInfo: Data.to(
      {
        desiredAssetSymbol: policyId,
        desiredAssetTokenName: assetName ?? "",
        receiverDatumHash: null,
        minimumReceive: amountOut,
      },
      MinswapRequestInfo
    ),
  };

  return {
    type: "ok",
    data: {
      kind: "advanced",
      data: advancedRouteRequest,
    },
  };
  // }}}
};

/**
 * Helper function for creating a `ReclaimConfig` which should be used to
 * cancel a swap request.
 * @param requestOutRef - Output reference of the UTxO at smart handles
 */
const mkReclaimConfig = (requestOutRef: OutRef): ReclaimConfig => {
  // {{{
  const advancedReclaimConfig: AdvancedReclaimConfig = {
    requestOutRef,
    outputDatum: { kind: "inline", value: Data.void() },
    extraLovelacesToBeLocked: 0n,
    additionalAction: (tx, _utxo) => tx,
  };
  return {
    kind: "advanced",
    data: advancedReclaimConfig,
  };
  // }}}
};

/**
 * Given a `slippageTolerance` and UTxO `outRef`, this function provides the
 * output datum maker required by `RouteConfig` based on the stored
 * `MinswapRequestInfo` stored in the UTxO fetched using `outRef`.
 *
 * Two additional checks are: there are no more than 2 assets stored in the
 * UTxO, and that an owner is specified in the input advanced datum.
 *
 * @param slippageTolerance - Swap slippage tolerance in percentages
 *        (e.g. 10 -> 10%)
 * @param outRef - Output reference of the UTxO at smart handles instance to be
 *        swapped
 * @param network - Target network, used for generating Bech32 address of the
 *        owner, extracted from input datum
 */
const mkRouteConfig = async (
  slippageTolerance: bigint,
  outRef: OutRef,
  network: Network
): Promise<Result<RouteConfig>> => {
  // {{{
  const outputDatumMaker = async (
    inputAssets: Assets,
    inputDatum: SmartHandleDatum
  ): Promise<Result<OutputDatum>> => {
    // {{{
    const units = Object.keys(inputAssets);

    if (units.length > 2)
      return {
        type: "error",
        error: new Error("More than 2 assets were found in the smart UTxO"),
      };

    if ("Owner" in inputDatum)
      return {
        type: "error",
        error: new Error(
          "Advanced datum expected, but simple datum was encountered"
        ),
      };

    const minswapRequestInfo = parseSafeDatum(
      Data.from(Data.to(inputDatum.ExtraInfo)),
      MinswapRequestInfo
    );

    if (minswapRequestInfo.type == "left")
      return { type: "error", error: new Error(minswapRequestInfo.value) };

    if (inputDatum.MOwner === null)
      return {
        type: "error",
        error: new Error("Locked UTxO encountered: no owners are specified"),
      };

    const orderDatum = makeOrderDatum(
      {
        policyId: minswapRequestInfo.value.desiredAssetSymbol,
        tokenName: minswapRequestInfo.value.desiredAssetTokenName,
      },
      toAddress(inputDatum.MOwner, network),
      (minswapRequestInfo.value.minimumReceive * (100n - slippageTolerance)) /
        100n
    );
    const outputDatum: OutputDatum = {
      kind: "inline",
      value: Data.to(orderDatum, OrderDatum),
    };
    return {
      type: "ok",
      data: outputDatum,
    };
    // }}}
  };

  return {
    type: "ok",
    data: {
      requestOutRef: outRef,
      extraLovelacesToBeLocked: MINSWAP_DEPOSIT + MINSWAP_BATCHER_FEE,
      additionalAction: (tx, _utxo) => tx,
      outputDatumMaker: outputDatumMaker as OutputDatumMaker,
    },
  };
  // }}}
};

const fetchUsersRequestUTxOs = async (
  forSingle: boolean,
  scriptCBOR: CBORHex,
  lucid: LucidEvolution,
  userAddress: Address,
): Promise<MinswapV1RequestUTxO[]> => {
  // {{{
  const network = lucid.config().network;
  const allRequests: UTxO[] = forSingle
    ? await fetchSingleRequestOutRefs(lucid, scriptCBOR, network)
    : await fetchBatchRequestUTxOs(lucid, scriptCBOR, network);
  console.log("Fetch completed:", allRequests);
  const initUsersRequests: (MinswapV1RequestUTxO | undefined)[] =
    allRequests.map((utxo) => {
      if (utxo.datum) {
        const advancedRes: Result<AdvancedDatumFields> = parseAdvancedDatum(
          utxo.datum,
          network
        );
        if (advancedRes.type == "error") {
          return undefined;
        } else {
          if (advancedRes.data.mOwner == userAddress) {
            return {
              outRef: {
                txHash: utxo.txHash,
                outputIndex: utxo.outputIndex,
              },
              datum: advancedRes.data,
              assets: utxo.assets,
            };
          } else {
            return undefined;
          }
        }
      } else {
        return undefined;
      }
    });
  // @ts-ignore
  return initUsersRequests.filter((u) => u !== undefined);
  // }}}
};
// }}}
// ----------------------------------------------------------------------------

// SINGLE CONFIG MAKERS -------------------------------------------------------
// {{{
/**
 * Given a `SwapRequest`, this function creates a `SingleRequestConfig` for
 * submitting a swap request.
 * @param swapRequest - `SwapRequest` consists of 3 fields:
 *   - fromAsset: Unit of the asset A to be converted
 *   - quantity: Amount of asset A
 *   - toAsset: Unit of desired asset B
 */
export const mkSingleRequestConfig = async (
  swapRequest: SwapRequest,
  network: Network
): Promise<Result<SingleRequestConfig>> => {
  // {{{
  const routeRequestRes = await mkRouteRequest(swapRequest, network);
  if (routeRequestRes.type == "error") return routeRequestRes;
  const appliedSpendingCBORRes = applyMinswapAddressToCBOR(
    singleSpendingValidator.cborHex,
    network
  );
  if (appliedSpendingCBORRes.type == "error") return appliedSpendingCBORRes;
  return ok({
    scriptCBOR: appliedSpendingCBORRes.data,
    routeRequest: routeRequestRes.data,
    additionalRequiredLovelaces: 0n,
  });
  // }}}
};

/**
 * Looks up all the UTxOs sitting at Minswap V1 instance of smart handles'
 * single spend script, and only keeps the ones with `AdvancedDatum`s, which
 * their `MOwner` field equals the given `userAddress` in `network`.
 * @param lucid - LucidEvolution API object
 * @param userAddress - Address of the user who had previously submitted request
 *        UTxOs at Minswap V1 instance of smart handles' batch spend script
 *        instance
 */
export const fetchUsersSingleRequestUTxOs = async (
  lucid: LucidEvolution,
  userAddress: Address,
): Promise<Result<MinswapV1RequestUTxO[]>> => {
  // {{{
  const appliedSpendingCBORRes = applyMinswapAddressToCBOR(
    singleSpendingValidator.cborHex,
    lucid.config().network
  );
  if (appliedSpendingCBORRes.type == "error") return appliedSpendingCBORRes;
  try {
    const userRequests = await fetchUsersRequestUTxOs(
        true,
        appliedSpendingCBORRes.data,
        lucid,
        userAddress,
      );
    return ok(userRequests);
  } catch(e) {
    return genericCatch(e);
  }
  // }}}
};

/**
 * Given a request `OutRef`, this function returns a `SingleReclaimConfig` for
 * Minswap V1 instance of smart handles.
 * @param requestOutRef - Output reference of the swap request UTxO at smart
 *        handles
 */
export const mkSingleReclaimConfig = (
  requestOutRef: OutRef,
  network: Network,
): Result<SingleReclaimConfig> => {
  // {{{
  const appliedSpendingCBORRes = applyMinswapAddressToCBOR(
    singleSpendingValidator.cborHex,
    network
  );
  if (appliedSpendingCBORRes.type == "error") return appliedSpendingCBORRes;
  return ok({
    scriptCBOR: appliedSpendingCBORRes.data,
    reclaimConfig: mkReclaimConfig(requestOutRef),
  });
  // }}}
};

/**
 * Given a `slippageTolerance` and UTxO `outRef`, this function determines asset
 * "A" from value of the UTxO, to be converted to desired asset "B" specified in
 * datum of the UTxO, and uses Blockfrost to find the current exchange rate.
 * @param slippageTolerance - Swap slippage tolerance in percentages
 *        (e.g. 10 -> 10%)
 * @param outRef - Output reference of the UTxO at smart handles instance to be
 *        swapped
 * @param network - Target network, used for both Blockfrost, and generating
 *        Bech32 address of the owner, extracted from input datum
 */
export const mkSingleRouteConfig = async (
  slippageTolerance: bigint,
  outRef: OutRef,
  network: Network
): Promise<Result<SingleRouteConfig>> => {
  // {{{
  const routeConfigRes = await mkRouteConfig(
    slippageTolerance,
    outRef,
    network
  );
  if (routeConfigRes.type == "error") return routeConfigRes;
  const appliedSpendingCBORRes = applyMinswapAddressToCBOR(
    singleSpendingValidator.cborHex,
    network
  );
  if (appliedSpendingCBORRes.type == "error") return appliedSpendingCBORRes;
  return ok({
    scriptCBOR: appliedSpendingCBORRes.data,
    routeAddress:
      network === "Mainnet" ? MINSWAP_ADDRESS_MAINNET : MINSWAP_ADDRESS_PREPROD,
    routeConfig: routeConfigRes.data,
  });
  // }}}
};
// }}}
// ----------------------------------------------------------------------------

// BATCH CONFIG MAKERS --------------------------------------------------------
// {{{
/**
 * Given a list of `SwapRequest` values, this function creates a
 * `BatchRequestConfig` for submitting multiple swap requests in a single
 * transaction.
 * @param swapRequests - Each `SwapRequest` consists of 3 fields:
 *   - fromAsset: Unit of the asset A to be converted
 *   - quantity: Amount of asset A
 *   - toAsset: Unit of desired asset B
 */
export const mkBatchRequestConfig = async (
  swapRequests: SwapRequest[],
  network: Network
): Promise<Result<BatchRequestConfig>> => {
  // {{{
  const allRequestConfigRes = await Promise.all(
    swapRequests.map(async (swapRequest) => {
      return await mkRouteRequest(swapRequest, network);
    })
  );
  const allRequestConfigs: RouteRequest[] = [];
  const allFailures = validateItems(
    allRequestConfigRes,
    (requestConfigRes) => {
      if (requestConfigRes.type == "error") {
        return errorToString(requestConfigRes.error);
      } else {
        allRequestConfigs.push(requestConfigRes.data);
      }
    },
    true
  );
  if (allFailures.length > 0) {
    return {
      type: "error",
      error: collectErrorMsgs(allFailures, "mkBatchRouteConfig"),
    };
  } else {
    const appliedStakingCBORRes = applyMinswapAddressToCBOR(
      stakingValidator.cborHex,
      network
    );
    if (appliedStakingCBORRes.type == "error") return appliedStakingCBORRes;
    return ok({
      stakingScriptCBOR: appliedStakingCBORRes.data,
      routeRequests: allRequestConfigs,
      additionalRequiredLovelaces: 0n,
    });
  }
  // }}}
};

/**
 * Looks up all the UTxOs sitting at Minswap V1 instance of smart handles'
 * batch spend script, and only keeps the ones with `AdvancedDatum`s, which
 * their `MOwner` field equals the given `userAddress` in `network`.
 * @param lucid - LucidEvolution API object
 * @param userAddress - Address of the user who had previously submitted request
 *        UTxOs at Minswap V1 instance of smart handles' batch spend script
 *        instance
 */
export const fetchUsersBatchRequestUTxOs = async (
  lucid: LucidEvolution,
  userAddress: Address,
): Promise<Result<MinswapV1RequestUTxO[]>> => {
  // {{{
  const appliedStakingCBORRes = applyMinswapAddressToCBOR(
    stakingValidator.cborHex,
    lucid.config().network
  );
  if (appliedStakingCBORRes.type == "error") return appliedStakingCBORRes;
  try {
    const userRequests = await fetchUsersRequestUTxOs(
      false,
      appliedStakingCBORRes.data,
      lucid,
      userAddress,
    );
    return ok(userRequests);
  } catch(e) {
    return genericCatch(e);
  }
  // }}}
};

/**
 * Given a list of request `OutRef` values, this function returns a
 * `BatchReclaimConfig` for Minswap V1 instance of smart handles.
 * @param requestOutRefs - List of output references of UTxOs at smart handles
 */
export const mkBatchReclaimConfig = (
  requestOutRefs: OutRef[],
  network: Network
): Result<BatchReclaimConfig> => {
  // {{{
  const appliedStakingCBORRes = applyMinswapAddressToCBOR(
    stakingValidator.cborHex,
    network
  );
  if (appliedStakingCBORRes.type == "error") return appliedStakingCBORRes;
  return ok({
    stakingScriptCBOR: appliedStakingCBORRes.data,
    reclaimConfigs: requestOutRefs.map(mkReclaimConfig),
  });
  // }}}
};

/**
 * Given a `slippageTolerance` and UTxO `outRef`s, this function determines
 * asset "A" from value of each UTxO, to be converted to desired asset "B"
 * specified in datums of each UTxO, and uses Blockfrost to find current
 * exchange rates.
 * @param slippageTolerance - Swap slippage tolerance in percentages
 *        (e.g. 10 -> 10%), shared for all swaps
 * @param outRefs - Output references of UTxOs at smart handles instance to be
 *        swapped
 * @param network - Target network, used for both Blockfrost, and generating
 *        Bech32 address of the owner, extracted from input datum
 */
export const mkBatchRouteConfig = async (
  slippageTolerance: bigint,
  outRefs: OutRef[],
  network: Network
): Promise<Result<BatchRouteConfig>> => {
  // {{{
  const allRouteConfigRes = await Promise.all(
    outRefs.map(async (outRef) => {
      return await mkRouteConfig(slippageTolerance, outRef, network);
    })
  );
  const allRouteConfigs: RouteConfig[] = [];
  const allFailures = validateItems(
    allRouteConfigRes,
    (routeConfigRes) => {
      if (routeConfigRes.type == "error") {
        return errorToString(routeConfigRes.error);
      } else {
        allRouteConfigs.push(routeConfigRes.data);
      }
    },
    true
  );
  if (allFailures.length > 0) {
    return {
      type: "error",
      error: collectErrorMsgs(allFailures, "mkBatchRouteConfig"),
    };
  } else {
    const appliedStakingCBORRes = applyMinswapAddressToCBOR(
      stakingValidator.cborHex,
      network
    );
    if (appliedStakingCBORRes.type == "error") return appliedStakingCBORRes;
    return ok({
      stakingScriptCBOR: appliedStakingCBORRes.data,
      routeAddress:
        network === "Mainnet"
          ? MINSWAP_ADDRESS_MAINNET
          : MINSWAP_ADDRESS_PREPROD,
      routeConfigs: allRouteConfigs,
    });
  }
  // }}}
};
// }}}
// ----------------------------------------------------------------------------
