// IMPORTS
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
  Network,
} from "@anastasia-labs/lucid-cardano-fork";
import {
  Asset,
  BlockfrostAdapter,
  calculateSwapExactIn,
  MetadataMessage,
  NetworkId,
  OrderDatum,
  OrderStep,
  OrderStepType,
  PoolDatum,
  PoolState,
} from "@minswap/sdk";
import { BlockFrostAPI } from "@blockfrost/blockfrost-js";
import {
  LOVELACE_MARGIN,
  ROUTER_FEE,
  ADA_MIN_PREPROD,
  ADA_MIN_MAINNET,
  AdaMinConstants,
  MINSWAP_BATCHER_FEE,
  MINSWAP_DEPOSIT,
} from "../core/constants.js";
import {
  AdaMinOutputDatum,
  OrderType,
  SmartHandleDatum,
} from "../core/contract.types.js";
import {
  BatchSwapConfig,
  Result,
  SingleSwapConfig,
  SwapConfig,
} from "../core/types.js";
import {
  BatchVAs,
  asyncValidateItems,
  collectErrorMsgs,
  compareOutRefs,
  genericCatch,
  getBatchVAs,
  getInputUtxoIndices,
  getSingleValidatorVA,
  parseSafeDatum,
  selectUtxos,
  toAddress,
} from "../core/utils/index.js";
// }}}

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

/**
 * Helper function for constructing the proper datum expected by Minswap's
 * script address.
 * @param minAsset - Policy ID and token name of the $MIN token. This can vary
 * based on the chosen network (mainnet or preprod)
 * @param ownerAddress - Address of the owner extracted from the input
 * `SmartHandleDatum`
 * @param minimumReceived - Minimum amount of $MIN tokens the owner should
 * receive
 */
const makeOrderDatum = (
  minAsset: Asset,
  ownerAddress: Address,
  minimumReceived: bigint
): OrderDatum => {
  // {{{
  return {
    sender: ownerAddress,
    receiver: ownerAddress,
    receiverDatumHash: undefined,
    step: {
      type: OrderStepType.SWAP_EXACT_IN,
      desiredAsset: minAsset,
      minimumReceived,
    },
    batcherFee: MINSWAP_BATCHER_FEE,
    depositADA: MINSWAP_DEPOSIT,
  };
  // }}}
};

/**
 * Intermediary datatype for mapping an input UTxO to its corresponding output
 * datum at the swap address.
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
 * @param config - Swap configurations (BF key, network, and slippage tolerance)
 * @param validatorAddress - Address of the smart handle script
 * @param requestOutRefs - `OutRef`s of the desired UTxOs to be spent
 */
const fetchUTxOsAndTheirCorrespondingOutputInfos = async (
  lucid: Lucid,
  config: SwapConfig,
  validatorAddress: Address,
  requestOutRefs: OutRef[]
): Promise<Result<InputUTxOAndItsOutputInfo[]>> => {
  // {{{
  const minConstants =
    config.network == "Mainnet" ? ADA_MIN_MAINNET : ADA_MIN_PREPROD;

  const blockfrostAdapter = new BlockfrostAdapter({
    blockFrost: new BlockFrostAPI({
      projectId: config.blockfrostKey,
      network: config.network == "Mainnet" ? "mainnet" : "preprod",
    }),
  });

  try {
    const poolStateRes = await getPoolStateById(
      blockfrostAdapter,
      minConstants.poolId
    );

    if (poolStateRes.type == "error") return poolStateRes;

    const poolState = poolStateRes.data;

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

        const inputLovelaces = utxo.assets["lovelace"];

        if (
          inputLovelaces <
          LOVELACE_MARGIN + MINSWAP_BATCHER_FEE + MINSWAP_DEPOSIT + ROUTER_FEE
        ) {
          return {
            type: "error",
            error: new Error("Insufficient Lovelaces"),
          };
        }

        const { amountOut } = calculateSwapExactIn({
          amountIn:
            inputLovelaces - MINSWAP_BATCHER_FEE - MINSWAP_DEPOSIT - ROUTER_FEE,
          reserveIn: poolState.reserveA,
          reserveOut: poolState.reserveB,
        });

        const outputDatum = makeOrderDatum(
          minConstants.minAsset,
          ownerAddress,
          amountOut
        );

        // Hashed since `SingleValidator` expects as such for the swap address
        // output UTxO.
        const outputDatumHash: OutputData = {
          asHash: Data.to(OrderDatum.toPlutusData(outputDatum)),
        };

        const outputAssets = {
          ...utxo.assets,
          lovelace: inputLovelaces - ROUTER_FEE,
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

export const singleSwap = async (
  lucid: Lucid,
  config: SingleSwapConfig
): Promise<Result<TxComplete>> => {
  // {{{
  const minConstants =
    config.swapConfig.network == "Mainnet" ? ADA_MIN_MAINNET : ADA_MIN_PREPROD;

  const vaRes = getSingleValidatorVA(
    lucid,
    minConstants.address,
    config.spendingScript
  );

  if (vaRes.type == "error") return vaRes;

  const validator: SpendingValidator = vaRes.data.validator;

  try {
    const outputInfoRes = await fetchUTxOsAndTheirCorrespondingOutputInfos(
      lucid,
      config.swapConfig,
      vaRes.data.address,
      [config.requestOutRef]
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
      .payToContract(minConstants.address, outputDatumHash, outputAssets)
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
  const minConstants =
    config.swapConfig.network == "Mainnet" ? ADA_MIN_MAINNET : ADA_MIN_PREPROD;

  const batchVAsRes = getBatchVAs(lucid, minConstants.address, config.scripts);

  if (batchVAsRes.type == "error") return batchVAsRes;

  const batchVAs: BatchVAs = batchVAsRes.data;

  try {
    const ownHash = paymentCredentialOf(await lucid.wallet.address()).hash;

    const initTx = lucid
      .newTx()
      .addSignerKey(ownHash) // For collateral UTxO
      .attachSpendingValidator(batchVAs.spendVA.validator)
      .attachWithdrawalValidator(batchVAs.stakeVA.validator);

    // Prior sorting needed as the traversal also adds corresponding outputs.
    const sortedOutRefs = config.requestOutRefs.sort(compareOutRefs);

    const outputInfosRes = await fetchUTxOsAndTheirCorrespondingOutputInfos(
      lucid,
      config.swapConfig,
      batchVAs.spendVA.address,
      sortedOutRefs
    );

    if (outputInfosRes.type == "error") return outputInfosRes;

    const utxosAndTheirOutputInfos = outputInfosRes.data;

    const swapUTxOs: UTxO[] = [];

    utxosAndTheirOutputInfos.forEach(inUTxOAndOutInfo => {
      swapUTxOs.push(inUTxOAndOutInfo.utxo);
      initTx.payToContract(
        minConstants.address,
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
