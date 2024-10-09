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
  AdvancedOutputDatumMaker,
  AdvancedReclaimConfig,
  AdvancedRouteConfig,
  AdvancedRouteRequest,
  Asset,
  Assets,
  BatchReclaimConfig,
  BatchRequestConfig,
  BatchRouteConfig,
  CBORHex,
  Data,
  DatumJson,
  LucidEvolution,
  Network,
  OutRef,
  OutputDatum,
  ROUTER_FEE,
  Result,
  RouteRequest,
  SingleReclaimConfig,
  SingleRequestConfig,
  SingleRouteConfig,
  TxSignBuilder,
  UTxO,
  Unit,
  applyParamsToScript,
  collectErrorMsgs,
  errorToString,
  fetchBatchRequestUTxOs,
  fetchSingleRequestUTxOs,
  fromAddress,
  fromAddressToData,
  fromUnit,
  genericCatch,
  ok,
  parseAdvancedDatum,
  parseSafeDatum,
  validateItems,
} from "@anastasia-labs/smart-handles-offchain";
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
import singleSpendingValidator from "./uplc/smartHandleSimple.json" with {type: "json"};
import stakingValidator from "./uplc/smartHandleStake.json" with {type: "json"};
// }}}
// ----------------------------------------------------------------------------

// UTILITY FUNCTIONS ----------------------------------------------------------
// {{{
export const applyMinswapAddressToCBOR = (
  cbor: string,
  _network: Network
): Result<string> => {
  // {{{
  // COMMENTED OUT SINCE HASKELL IS NOW GENERATING THEM FULLY APPLIED
  //
  // const addressRes = fromAddressToData(
  //   network === "Mainnet" ? MINSWAP_ADDRESS_MAINNET : MINSWAP_ADDRESS_PREPROD
  // );
  // if (addressRes.type == "error") return addressRes;
  // const finalCBOR = applyParamsToScript(cbor, [addressRes.data]);

  // Uncomment for writing applied CBORs to disk.
  // const filePath = './applied.cbor';
  // fs.writeFile(filePath, finalCBOR, (err) => {
  //   if (err) {
  //     console.error('Error writing file:', err);
  //   } else {
  //     console.log('File written successfully');
  //   }
  // });

  return {
    type: "ok",
    data: cbor,
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
  slippageTolerance: bigint;
};

export const mkMinswapRequestInfo = (
  policyId: string,
  assetName: string | null,
  minimumReceive: bigint
): DatumJson => {
  return {
    constructor: 0,
    fields: [
      { bytes: policyId },
      { bytes: assetName ?? "" },
      { constructor: 1, fields: [] },
      { int: Number(minimumReceive) },
    ],
  };
};

/**
 * Helper function for creating a `RouteRequest` for a swap request. `Asset` is
 * identical to "unit," i.e. concatenation of asset's policy with its token name
 * in hex format.
 *
 * This function uses Blockfrost to determine the exchange rate, and stores it
 * in the `minimumReceive` field of `extraInfo`.
 *
 * @param ownerAddress - Address to be stored in the datum as owner
 * @param swapRequest - Consists of 3 fields:
 *   - fromAsset: Unit of the asset A to be converted
 *   - quantity: Amount of asset A
 *   - toAsset: Unit of desired asset B
 * @param network - Target network
 * @param manualMinimumReceive - Optional argument to disregard current market
 *        exchange rate (consequently won't query Blockfrost)
 */
export const mkRouteRequest = async (
  ownerAddress: Address,
  { fromAsset, quantity, toAsset, slippageTolerance }: SwapRequest,
  network: Network,
  manualMinimumReceive?: bigint
): Promise<Result<RouteRequest>> => {
  // {{{
  const minLovelaces = MINSWAP_BATCHER_FEE + MINSWAP_DEPOSIT + ROUTER_FEE;
  const valueToLock =
    fromAsset === "lovelace" || fromAsset === ""
      ? {
          lovelace: minLovelaces + quantity,
        }
      : {
          lovelace: minLovelaces,
          [fromAsset]: quantity,
        };

  let minimumReceive: bigint;

  if (manualMinimumReceive === undefined) {
    const blockfrostKey = process.env.BLOCKFROST_KEY;
    if (!blockfrostKey) {
      return {
        type: "error",
        error: new Error("No Blockfrost API key was found"),
      };
    }
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
    // minimumReceive = amountOut;
    minimumReceive = (amountOut * (100n - slippageTolerance)) / 100n;
  } else {
    // minimumReceive = manualMinimumReceive;
    minimumReceive = (manualMinimumReceive * (100n - slippageTolerance)) / 100n;
  }

  const { policyId, assetName } =
    toAsset === "" ? { policyId: "", assetName: "" } : fromUnit(toAsset);
  const advancedRouteRequest: AdvancedRouteRequest = {
    valueToLock,
    owner: ownerAddress,
    routerFee: ROUTER_FEE,
    reclaimRouterFee: 0n,
    routeRequiredMint: null,
    reclaimRequiredMint: null,
    extraInfoDataBuilder: () => {
      return mkMinswapRequestInfo(policyId, assetName, minimumReceive);
    },
  };

  return ok({
    kind: "advanced",
    data: advancedRouteRequest,
  });
  // }}}
};

/**
 * Helper function for creating an `AdvancedReclaimConfig`.
 */
export const mkReclaimConfig = (): AdvancedReclaimConfig => {
  return {
    outputDatumMaker: async (_inputAssets, _inputDatum) =>
      ok({ kind: "inline", value: Data.void() }),
    additionalAction: async (tx, _utxo) => {
      try {
        const txConfig = await tx.config();
        const owner = await txConfig.lucidConfig.wallet?.address();
        if (owner) {
          return ok(tx.addSigner(owner));
        } else {
          return {
            type: "error",
            error: new Error(
              "Failed to fetch wallet address from partially built transaction to specify as owner"
            ),
          };
        }
      } catch (e) {
        return genericCatch(e);
      }
    },
  };
};

export const mkRouteConfig = (): AdvancedRouteConfig => {
  // {{{
  const outputDatumMaker: AdvancedOutputDatumMaker = async (
    inputAssets: Assets,
    inputDatum: AdvancedDatumFields
  ): Promise<Result<OutputDatum>> => {
    // {{{
    try {
      const units = Object.keys(inputAssets);

      if (units.length > 2)
        return {
          type: "error",
          error: new Error("More than 2 assets were found in the smart UTxO"),
        };

      const minswapRequestInfo = parseSafeDatum(
        Data.to(inputDatum.extraInfo),
        MinswapRequestInfo
      );

      if (minswapRequestInfo.type == "left")
        return { type: "error", error: new Error(minswapRequestInfo.value) };

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
        inputDatum.mOwner,
        minswapRequestInfo.value.minimumReceive
        // (minswapRequestInfo.value.minimumReceive * (100n - slippageTolerance)) /
        //   100n
      );
      const outputDatum: OutputDatum = {
        kind: "inline",
        value: Data.to(orderDatum, OrderDatum),
      };
      return ok(outputDatum);
    } catch (e) {
      return genericCatch(e);
    }
    // }}}
  };

  return {
    additionalAction: async (tx, _utxo) => ok(tx),
    outputDatumMaker: outputDatumMaker,
  };
  // }}}
};

const fetchUsersRequestUTxOs = async (
  forSingle: boolean,
  scriptCBOR: CBORHex,
  lucid: LucidEvolution,
  userAddress: Address
): Promise<MinswapV1RequestUTxO[]> => {
  // {{{
  const network = lucid.config().network;
  const allRequests: UTxO[] = forSingle
    ? await fetchSingleRequestUTxOs(lucid, scriptCBOR)
    : await fetchBatchRequestUTxOs(lucid, scriptCBOR);
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

/**
 * Sign and submit a completed transaction.
 * @param lucid - Lucid Evolution API object, implicit assumption that signer is
 *        already selected
 * @param txRes - Completed transaction, wrapped under a `Result`
 */
export const signAndSubmitTxRes = async (
  lucid: LucidEvolution,
  txRes: Result<TxSignBuilder>
): Promise<string> => {
  if (txRes.type == "error") throw txRes.error;
  const txSigned = await txRes.data.sign.withWallet().complete();
  const txHash = await txSigned.submit();
  await lucid.awaitTx(txHash);
  return txHash;
};
// }}}
// ----------------------------------------------------------------------------

// SINGLE CONFIG MAKERS -------------------------------------------------------
// {{{
/**
 * Given a `SwapRequest`, this function creates a `SingleRequestConfig` for
 * submitting a swap request.
 * @param ownerAddress - Address to be stored in the datum as owner
 * @param swapRequest - `SwapRequest` consists of 3 fields:
 *   - fromAsset: Unit of the asset A to be converted
 *   - quantity: Amount of asset A
 *   - toAsset: Unit of desired asset B
 * @param network - Target network
 * @param manualMinimumReceive - Optional argument to disregard current market
 *        exchange rate (consequently won't query Blockfrost)
 */
export const mkSingleRequestConfig = async (
  ownerAddress: Address,
  swapRequest: SwapRequest,
  network: Network,
  manualMinimumReceive?: bigint
): Promise<Result<SingleRequestConfig>> => {
  // {{{
  const routeRequestRes = await mkRouteRequest(
    ownerAddress,
    swapRequest,
    network,
    manualMinimumReceive
  );
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
  userAddress: Address
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
      userAddress
    );
    return ok(userRequests);
  } catch (e) {
    return genericCatch(e);
  }
  // }}}
};

/**
 * Given a request `OutRef`, this function returns a `SingleReclaimConfig` for
 * Minswap V1 instance of smart handles.
 * @param requestOutRef - Output reference of the swap request UTxO at smart
 *        handles
 * @param owner - Bech32 address of the request owner
 * @param network - Target network, used for determining the route address
 */
export const mkSingleReclaimConfig = (
  requestOutRef: OutRef,
  network: Network
): Result<SingleReclaimConfig> => {
  // {{{
  const appliedSpendingCBORRes = applyMinswapAddressToCBOR(
    singleSpendingValidator.cborHex!,
    network
  );
  if (appliedSpendingCBORRes.type == "error") return appliedSpendingCBORRes;
  return ok({
    requestOutRef,
    scriptCBOR: appliedSpendingCBORRes.data,
    advancedReclaimConfig: mkReclaimConfig(),
  });
  // }}}
};

/**
 * Given a UTxO `outRef`, this function determines asset
 * "A" from value of the UTxO, to be converted to desired asset "B" specified in
 * datum of the UTxO, and uses Blockfrost to find the current exchange rate.
 * @param outRef - Output reference of the UTxO at smart handles instance to be
 *        swapped
 * @param network - Target network, used for both Blockfrost, and generating
 *        Bech32 address of the owner, extracted from input datum
 */
export const mkSingleRouteConfig = (
  outRef: OutRef,
  network: Network
): Result<SingleRouteConfig> => {
  // {{{
  const routeConfig = mkRouteConfig();
  const appliedSpendingCBORRes = applyMinswapAddressToCBOR(
    singleSpendingValidator.cborHex,
    network
  );
  if (appliedSpendingCBORRes.type == "error") return appliedSpendingCBORRes;
  return ok({
    requestOutRef: outRef,
    scriptCBOR: appliedSpendingCBORRes.data,
    routeAddress:
      network === "Mainnet" ? MINSWAP_ADDRESS_MAINNET : MINSWAP_ADDRESS_PREPROD,
    advancedRouteConfig: routeConfig,
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
 * @param ownerAddress - Address to be stored in the datum as owner
 * @param swapRequests - Each `SwapRequest` consists of 3 fields:
 *   - fromAsset: Unit of the asset A to be converted
 *   - quantity: Amount of asset A
 *   - toAsset: Unit of desired asset B
 * @param network - Target network, used for figuring out the swap address
 * @param manualMinimumReceives - Optional argument to disregard current market
 *        exchange rates (consequently won't query Blockfrost)
 */
export const mkBatchRequestConfig = async (
  ownerAddress: Address,
  swapRequests: SwapRequest[],
  network: Network,
  manualMinimumReceives?: bigint[]
): Promise<Result<BatchRequestConfig>> => {
  // {{{
  const allRequestConfigRes = await Promise.all(
    swapRequests.map(async (swapRequest, index) => {
      return await mkRouteRequest(
        ownerAddress,
        swapRequest,
        network,
        manualMinimumReceives !== undefined
          ? manualMinimumReceives[index]
          : undefined
      );
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
  userAddress: Address
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
      userAddress
    );
    return ok(userRequests);
  } catch (e) {
    return genericCatch(e);
  }
  // }}}
};

/**
 * Given a list of request `OutRef` values, this function returns a
 * `BatchReclaimConfig` for Minswap V1 instance of smart handles.
 * @param requestOutRefs - List of output references of UTxOs at smart handles
 * @param owner - Bech32 address of the owner of requests (assumes all belong to
 *        one owner)
 * @param network - Target network, used for determining the route address
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
    requestOutRefs,
    stakingScriptCBOR: appliedStakingCBORRes.data,
    advancedReclaimConfig: mkReclaimConfig(),
  });
  // }}}
};

/**
 * Given a UTxO `outRef`s, this function determines
 * asset "A" from value of each UTxO, to be converted to desired asset "B"
 * specified in datums of each UTxO, and uses Blockfrost to find current
 * exchange rates.
 * @param outRefs - Output references of UTxOs at smart handles instance to be
 *        swapped
 * @param network - Target network, used for both Blockfrost, and generating
 *        Bech32 address of the owner, extracted from input datum
 */
export const mkBatchRouteConfig = (
  outRefs: OutRef[],
  network: Network
): Result<BatchRouteConfig> => {
  // {{{
  const routeConfig = mkRouteConfig();
  const appliedStakingCBORRes = applyMinswapAddressToCBOR(
    stakingValidator.cborHex,
    network
  );
  if (appliedStakingCBORRes.type == "error") return appliedStakingCBORRes;
  return ok({
    requestOutRefs: outRefs,
    stakingScriptCBOR: appliedStakingCBORRes.data,
    routeAddress:
      network === "Mainnet" ? MINSWAP_ADDRESS_MAINNET : MINSWAP_ADDRESS_PREPROD,
    advancedRouteConfig: routeConfig,
  });
  // }}}
};
// }}}
// ----------------------------------------------------------------------------
