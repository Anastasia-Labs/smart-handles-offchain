// IMPORTS --------------------------------------------------------------------
// {{{
import {
  Assets,
  Constr,
  Data,
  OutputData,
  Lucid,
  SpendingValidator,
  TxComplete,
  paymentCredentialOf,
  OutRef,
  Address,
  UTxO,
  fromUnit,
  Unit,
  toUnit,
} from "@anastasia-labs/lucid-cardano-fork";
import {
  Asset as MinswapAsset,
  BlockfrostAdapter,
  calculateSwapExactIn,
  MetadataMessage,
  PoolState,
} from "@minswap/sdk";
import { BlockFrostAPI } from "@blockfrost/blockfrost-js";
import {
  LOVELACE_MARGIN,
  ROUTER_FEE,
  MINSWAP_BATCHER_FEE,
  MINSWAP_DEPOSIT,
  MINSWAP_ADDRESS_PREPROD,
  MINSWAP_ADDRESS_MAINNET,
} from "../core/constants.js";
import {
  OrderDatum,
  OrderType,
  SmartHandleDatum,
} from "../core/contract.types.js";
import {
  Asset,
  BatchSwapConfig,
  Result,
  SingleSwapConfig,
  SwapConfig,
} from "../core/types.js";
import {
  BatchVAs,
  compareOutRefs,
  fromAddress,
  genericCatch,
  getBatchVAs,
  getInputUtxoIndices,
  getSingleValidatorVA,
  parseSafeDatum,
  selectUtxos,
  toAddress,
} from "../core/utils/index.js";
// }}}
// ----------------------------------------------------------------------------

// UTILITY FUNCTIONS ----------------------------------------------------------
// {{{
const getPoolStateById = async (
  blockfrostAdapter: BlockfrostAdapter,
  poolId: string
): Promise<Result<PoolState>> => {
  // {{{
  try {
    const pool = await blockfrostAdapter.getPoolById({
      id: poolId,
    });
    if (!pool) {
      return {
        type: "error",
        error: new Error(`Not found PoolState of ID: ${poolId}`),
      };
    }
    return {
      type: "ok",
      data: pool,
    };
  } catch (error) {
    return genericCatch(error);
  }
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

/**
 * Intermediary datatype for mapping an input UTxO to its corresponding output
 * datum and output assets at the swap address.
 */
type InputUTxOAndItsOutputInfo = {
  utxo: UTxO;
  outputAssets: Assets;
  outputDatumHash: OutputData;
};

/**
 * Given a list of `OutRef`s, this function attempts to fetch them all and
 * performs a set of validations on them:
 * - Their datums are `SmartHandleDatum`s
 * - They are sitting at the given validator address
 * - They have enough Ada to cover the batcher fee, deposit, and the margin
 * Next it'll attempt to find the appropriate minimum tokens received based on
 * the amount of Lovelaces present in each UTxO. It'll return a mapping of the
 * input UTxOs to their corresponding output infos, consisting of:
 * - Output assets, which is identical to the input assets with router fee
 *   deduced
 * - Output data, which is the expected `OrderDatum` hashed
 * Preserves ordering of UTxOs based on input `OutRef`s.
 * Note that it'll silently discard inputs that don't satisfy these conditions:
 * - Are not from the validator address
 * - Don't have a proper datum
 * - Don't have enough Lovelaces
 * @param lucid - Lucid API object
 * @param config - Swap configurations (BF key, desired asset, pool ID of the asset, and slippage tolerance)
 * @param validatorAddress - Address of the smart handle script
 * @param requestOutRefs - `OutRef`s of the desired UTxOs to be spent
 * @param testnet - Flag for preprod network or mainnet
 */
const fetchUTxOsAndTheirCorrespondingOutputInfos = async (
  lucid: Lucid,
  config: SwapConfig,
  validatorAddress: Address,
  requestOutRefs: OutRef[],
  testnet: boolean
): Promise<Result<InputUTxOAndItsOutputInfo[]>> => {
  // {{{
  const blockfrostAdapter = new BlockfrostAdapter({
    blockFrost: new BlockFrostAPI({
      projectId: config.blockfrostKey,
      network: testnet ? "preprod" : "mainnet",
    }),
  });

  try {
    const utxos = await lucid.utxosByOutRef(requestOutRefs);

    const results = await Promise.all(
      utxos.map(async (utxo: UTxO) => {
        if (utxo.address !== validatorAddress)
          return {
            type: "error",
            error: new Error("UTxO is not coming from the script address"),
          };

        const datum = parseSafeDatum(lucid, utxo.datum, SmartHandleDatum);

        if (datum.type == "left")
          return { type: "error", error: new Error(datum.value) };

        const ownerAddress = toAddress(datum.value.owner, lucid);

        const units = Object.keys(utxo.assets);

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
            ? utxo.assets["lovelace"] -
              MINSWAP_BATCHER_FEE -
              MINSWAP_DEPOSIT -
              ROUTER_FEE
            : utxo.assets[fromAssetStr];

        // CAUTION: If `poolId` is provided, there is no validation to make sure
        // it correctly corresponds the swap pair.
        const poolStateRes = config.poolId
          ? await getPoolStateById(blockfrostAdapter, config.poolId)
          : await getPoolStateFromAssets(
              blockfrostAdapter,
              fromAssetStr,
              toUnit(
                datum.value.extraInfo.desiredAssetSymbol,
                datum.value.extraInfo.desiredAssetTokenName
              )
            );

        if (poolStateRes.type == "error") return poolStateRes;

        const poolState = poolStateRes.data;

        const { amountOut } = calculateSwapExactIn({
          amountIn,
          reserveIn: poolState.reserveA,
          reserveOut: poolState.reserveB,
        });

        const outputDatum = makeOrderDatum(
          {
            policyId: datum.value.extraInfo.desiredAssetSymbol,
            tokenName: datum.value.extraInfo.desiredAssetTokenName,
          },
          ownerAddress,
          (amountOut * (100n - config.slippageTolerance)) / 100n
        );

        const outputDatumCBOR = Data.to<OrderDatum>(outputDatum, OrderDatum);

        // Hashed since `SingleValidator` expects as such for the swap address
        // output UTxO.
        const outputDatumHash: OutputData = {
          asHash: outputDatumCBOR,
        };

        const outputAssets = {
          ...utxo.assets,
          lovelace: utxo.assets["lovelace"] - ROUTER_FEE,
        };
        return {
          type: "ok",
          data: {
            utxo,
            outputAssets,
            outputDatumHash,
          },
        };
      })
    );
    return {
      type: "ok",
      data: results.filter((r) => r.type == "ok").map((r) => r.data!),
    };
  } catch (error) {
    return genericCatch(error);
  }
  // }}}
};

const getRedeemerIndicesAndFeeUTxOs = async (
  lucid: Lucid,
  utxosToSpend: UTxO[]
): Promise<Result<[bigint[], UTxO[]]>> => {
  // {{{
  try {
    const walletUTxOs = await lucid.wallet.getUtxos();

    // Using `LOVELACE_MARGIN` as the minimum required Lovelaces so that the
    // collected routing fee minus the transaction fee doesn't go below the min
    // required Lovelaces for a UTxO. TODO?
    const requiredAssets: Assets = { lovelace: LOVELACE_MARGIN };

    const selectedUtxos = selectUtxos(walletUTxOs, requiredAssets);

    if (selectedUtxos.type == "error") return selectedUtxos;

    const inputIndices = getInputUtxoIndices(utxosToSpend, selectedUtxos.data);
    return {
      type: "ok",
      data: [inputIndices, selectedUtxos.data],
    };
  } catch (error) {
    return genericCatch(error);
  }
  // }}}
};
// }}}
// ----------------------------------------------------------------------------

export const singleSwap = async (
  lucid: Lucid,
  config: SingleSwapConfig
): Promise<Result<TxComplete>> => {
  // {{{
  const vaRes = getSingleValidatorVA(lucid, config.testnet);

  if (vaRes.type == "error") return vaRes;

  const validator: SpendingValidator = vaRes.data.validator;

  try {
    const outputInfoRes = await fetchUTxOsAndTheirCorrespondingOutputInfos(
      lucid,
      config.swapConfig,
      vaRes.data.address,
      [config.requestOutRef],
      config.testnet
    );

    if (outputInfoRes.type == "error") return outputInfoRes;

    // Expecting exactly one element.
    const [{ utxo: utxoToSpend, outputDatumHash, outputAssets }] =
      outputInfoRes.data;

    const ownHash = paymentCredentialOf(await lucid.wallet.address()).hash;

    const redeemerIndicesAndFeeUTxOsRes = await getRedeemerIndicesAndFeeUTxOs(
      lucid,
      [utxoToSpend]
    );

    if (redeemerIndicesAndFeeUTxOsRes.type == "error")
      return redeemerIndicesAndFeeUTxOsRes;

    const [inputIndices, feeUTxOs] = redeemerIndicesAndFeeUTxOsRes.data;

    if (inputIndices.length !== 1)
      return { type: "error", error: new Error("Something went wrong") };

    const swapAddress = config.testnet
      ? MINSWAP_ADDRESS_PREPROD
      : MINSWAP_ADDRESS_MAINNET;

    const PSwapRedeemer = Data.to(new Constr(0, [inputIndices[0], 0n]));

    // Implicit assumption that who creates the transaction is the routing
    // agent. Therefore the change output from the spent UTxO (which is getting
    // reproduced at the swap address with `ROUTER_FEE` less Lovelaces), is
    // going to be collected by the routing agent.
    const tx = await lucid
      .newTx()
      .collectFrom([utxoToSpend], PSwapRedeemer)
      .collectFrom(feeUTxOs)
      .addSignerKey(ownHash) // For collateral UTxO
      .attachSpendingValidator(validator)
      .payToContract(swapAddress, outputDatumHash, outputAssets)
      .attachMetadata(674, { msg: [MetadataMessage.SWAP_EXACT_IN_ORDER] })
      .complete();
    return { type: "ok", data: tx };
  } catch (error) {
    return genericCatch(error);
  }
  // }}}
};

export const batchSwap = async (
  lucid: Lucid,
  config: BatchSwapConfig
): Promise<Result<TxComplete>> => {
  // {{{
  const batchVAsRes = getBatchVAs(lucid, config.testnet);

  if (batchVAsRes.type == "error") return batchVAsRes;

  const batchVAs: BatchVAs = batchVAsRes.data;

  const swapAddress = config.testnet
    ? MINSWAP_ADDRESS_PREPROD
    : MINSWAP_ADDRESS_MAINNET;

  try {
    const ownHash = paymentCredentialOf(await lucid.wallet.address()).hash;

    const initTx = lucid
      .newTx()
      .addSignerKey(ownHash) // For collateral UTxO
      .attachSpendingValidator(batchVAs.spendVA.validator)
      .attachWithdrawalValidator(batchVAs.stakeVA.validator)
      .attachMetadata(674, { msg: [MetadataMessage.SWAP_EXACT_IN_ORDER] });

    // Prior sorting needed as the traversal also adds corresponding outputs.
    const sortedOutRefs = config.requestOutRefs.sort(compareOutRefs);

    const outputInfosRes = await fetchUTxOsAndTheirCorrespondingOutputInfos(
      lucid,
      config.swapConfig,
      batchVAs.spendVA.address,
      sortedOutRefs,
      config.testnet
    );

    if (outputInfosRes.type == "error") return outputInfosRes;

    const utxosAndTheirOutputInfos = outputInfosRes.data;

    const swapUTxOs: UTxO[] = [];

    utxosAndTheirOutputInfos.forEach((inUTxOAndOutInfo) => {
      swapUTxOs.push(inUTxOAndOutInfo.utxo);
      initTx.payToContract(
        swapAddress,
        inUTxOAndOutInfo.outputDatumHash,
        inUTxOAndOutInfo.outputAssets
      );
    });

    const redeemerIndicesAndFeeUTxOsRes = await getRedeemerIndicesAndFeeUTxOs(
      lucid,
      swapUTxOs
    );

    if (redeemerIndicesAndFeeUTxOsRes.type == "error")
      return redeemerIndicesAndFeeUTxOsRes;

    const [inputIndices, feeUTxOs] = redeemerIndicesAndFeeUTxOsRes.data;

    const PSwapRedeemerSpend = Data.to(new Constr(0, []));

    const PSwapRedeemerWdrl = Data.to(
      new Constr(0, [
        inputIndices,
        Array.from({ length: inputIndices.length }, (_, index) => index).map(
          BigInt
        ),
      ])
    );
    const tx = await initTx
      .collectFrom(swapUTxOs, PSwapRedeemerSpend)
      .collectFrom(feeUTxOs)
      .withdraw(batchVAs.stakeVA.address, 0n, PSwapRedeemerWdrl)
      .complete();
    return { type: "ok", data: tx };
  } catch (error) {
    return genericCatch(error);
  }
  // }}}
};
