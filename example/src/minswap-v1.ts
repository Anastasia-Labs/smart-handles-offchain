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
  AdvancedDatum,
  AdvancedOutputDatumMaker,
  AdvancedReclaimConfig,
  AdvancedRouteRequest,
  Asset,
  Assets,
  BatchRequestConfig,
  BatchRouteConfig,
  Data,
  Network,
  OutRef,
  OutputDatum,
  ROUTER_FEE,
  ReclaimConfig,
  Result,
  RouteConfig,
  RouteRequest,
  SingleRouteConfig,
  Unit,
  collectErrorMsgs,
  errorToString,
  fromAddress,
  fromUnit,
  genericCatch,
  parseSafeDatum,
  toAddress,
  toUnit,
  validateItems,
} from "../../src/index.js";
import { MinswapRequestInfo, OrderDatum, OrderType } from "./types.js";
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
 * @param swapRequest - Consists of 3 fields:
 *   - fromAsset: Unit of the asset A to be converted
 *   - quantity: Amount of asset A
 *   - toAsset: Unit of desired asset B
 */
const mkRouteRequest = ({
  fromAsset,
  quantity,
  toAsset,
}: SwapRequest): RouteRequest => {
  // {{{
  const minLovelaces = MINSWAP_BATCHER_FEE + MINSWAP_DEPOSIT + ROUTER_FEE;
  const splitUnit = fromUnit(toAsset);
  const advancedRouteRequest: AdvancedRouteRequest = {
    valueToLock:
      fromAsset === "lovelace"
        ? {
            lovelace: minLovelaces + quantity,
          }
        : {
            lovelace: minLovelaces,
            [fromAsset]: quantity,
          },
    markWalletAsOwner: true,
    routerFee: ROUTER_FEE,
    reclaimRouterFee: 0n,
    extraInfo: Data.to(
      {
        desiredAssetSymbol: splitUnit.policyId,
        desiredAssetTokenName: splitUnit.assetName ?? "",
      },
      MinswapRequestInfo
    ),
  };
  return {
    kind: "advanced",
    data: advancedRouteRequest,
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
const mkRouteConfig = async (
  slippageTolerance: bigint,
  outRef: OutRef,
  network: Network
): Promise<Result<RouteConfig>> => {
  // {{{
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

  const outputDatumMaker = async (
    inputAssets: Assets,
    inputDatum: AdvancedDatum
  ): Promise<Result<OutputDatum>> => {
    // {{{
    const units = Object.keys(inputAssets);

    if (units.length > 2)
      return {
        type: "error",
        error: new Error("More than 2 assets were found in the smart UTxO"),
      };

    const fromAssetStr =
      units.length == 2
        ? units.filter((k: string) => k != "lovelace")[0]
        : "lovelace";

    const amountIn =
      fromAssetStr == "lovelace"
        ? inputAssets["lovelace"] -
          MINSWAP_BATCHER_FEE -
          MINSWAP_DEPOSIT -
          inputDatum.routerFee
        : inputAssets[fromAssetStr];

    const minswapRequestInfo = parseSafeDatum(
      Data.from(Data.to(inputDatum.extraInfo)),
      MinswapRequestInfo
    );

    if (minswapRequestInfo.type == "left")
      return { type: "error", error: new Error(minswapRequestInfo.value) };

    const poolStateRes = await getPoolStateFromAssets(
      blockfrostAdapter,
      fromAssetStr,
      toUnit(
        minswapRequestInfo.value.desiredAssetSymbol,
        minswapRequestInfo.value.desiredAssetTokenName
      )
    );

    if (poolStateRes.type == "error") return poolStateRes;

    const poolState = poolStateRes.data;

    const { amountOut } = calculateSwapExactIn({
      amountIn,
      reserveIn: poolState.reserveA,
      reserveOut: poolState.reserveB,
    });

    if (inputDatum.mOwner === null)
      return {
        type: "error",
        error: new Error("Locked UTxO encountered: no owners are specified"),
      };

    const orderDatum = makeOrderDatum(
      {
        policyId: minswapRequestInfo.value.desiredAssetSymbol,
        tokenName: minswapRequestInfo.value.desiredAssetTokenName,
      },
      toAddress(inputDatum.mOwner, network),
      (amountOut * (100n - slippageTolerance)) / 100n
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
      kind: "advanced",
      data: {
        requestOutRef: outRef,
        extraLovelacesToBeLocked: MINSWAP_DEPOSIT + MINSWAP_BATCHER_FEE,
        additionalAction: (tx, _utxo) => tx,
        outputDatumMaker: outputDatumMaker as AdvancedOutputDatumMaker,
      },
    },
  };
  // }}}
};
// }}}
// ----------------------------------------------------------------------------

/**
 * Given a list of `SwapRequest` values, this function creates a
 * `BatchRequestConfig` for submitting multiple swap requests in a single
 * transaction.
 * @param swapRequests - Each `SwapRequest`onsists of 3 fields:
 *   - fromAsset: Unit of the asset A to be converted
 *   - quantity: Amount of asset A
 *   - toAsset: Unit of desired asset B
 */
export const mkBatchRequestConfig = (
  swapRequests: SwapRequest[]
): BatchRequestConfig => {
  // {{{
  return {
    stakingScriptCBOR: stakingValidator.cborHex,
    routeRequests: swapRequests.map(mkRouteRequest),
    additionalRequiredLovelaces: 0n,
  };
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
    return {
      type: "ok",
      data: {
        stakingScriptCBOR: stakingValidator.cborHex,
        routeAddress:
          network === "Mainnet"
            ? MINSWAP_ADDRESS_MAINNET
            : MINSWAP_ADDRESS_PREPROD,
        routeConfigs: allRouteConfigs,
      },
    };
  }
  // }}}
};
