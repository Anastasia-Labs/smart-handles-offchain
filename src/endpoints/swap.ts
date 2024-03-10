import {
  Assets,
  Constr,
  Data,
  OutputData,
  Lucid,
  SpendingValidator,
  TxComplete,
  paymentCredentialOf,
} from "@anastasia-labs/lucid-cardano-fork";
import {
  LOVELACE_MARGIN,
  MIN_SYMBOL,
  MIN_TOKEN_NAME,
  ROUTER_FEE,
} from "../core/constants.js";
import {
  AdaMinOutputDatum,
  OrderType,
  SmartHandleDatum,
} from "../core/contract.types.js";
import { BatchSwapConfig, Result, SingleSwapConfig } from "../core/types.js";
import {
  BatchVAs,
  genericCatch,
  getBatchVAs,
  getInputUtxoIndices,
  getSingleValidatorVA,
  parseSafeDatum,
  selectUtxos,
} from "../core/utils/index.js";

export const singleSwap = async (
  lucid: Lucid,
  config: SingleSwapConfig
): Promise<Result<TxComplete>> => {
  const vaRes = getSingleValidatorVA(
    lucid,
    config.swapAddress,
    config.spendingScript
  );

  if (vaRes.type == "error") return vaRes;

  try {
    const validator: SpendingValidator = vaRes.data.validator;

    const [utxoToSpend] = await lucid.utxosByOutRef([config.requestOutRef]);

    if (!utxoToSpend)
      return { type: "error", error: new Error("No UTxO with that TxOutRef") };

    if (!utxoToSpend.datum)
      return { type: "error", error: new Error("Missing Datum") };

    if (utxoToSpend.address !== vaRes.data.address)
      return {
        type: "error",
        error: new Error("UTxO is not coming from the script address"),
      };

    const datum = parseSafeDatum(lucid, utxoToSpend.datum, SmartHandleDatum);

    if (datum.type == "left")
      return { type: "error", error: new Error(datum.value) };

    const ownerAddress = datum.value.owner;

    const outputOrderType: OrderType = {
      desiredAsset: {
        symbol: MIN_SYMBOL,
        name: MIN_TOKEN_NAME,
      },
      minReceive: config.minReceive,
    };

    const outputDatum: AdaMinOutputDatum = {
      sender: ownerAddress,
      receiver: ownerAddress,
      receiverDatumHash: null,
      step: outputOrderType,
      batcherFee: 2000000n,
      outputAda: 2000000n,
    };

    const outputDatumData = Data.to<AdaMinOutputDatum>(
      outputDatum,
      AdaMinOutputDatum
    );

    // Hashed since `SingleValidator` expects as such for the swap address
    // output UTxO.
    const outputDatumHash: OutputData = {
      asHash: outputDatumData,
    };

    const inputLovelaces = utxoToSpend.assets["lovelace"];

    if (inputLovelaces < ROUTER_FEE + LOVELACE_MARGIN)
      return {
        type: "error",
        error: new Error("Not enough Lovelaces are present in the UTxO"),
      };

    const outputAssets = {
      ...utxoToSpend.assets,
      lovelace: inputLovelaces - ROUTER_FEE,
    };
    const ownHash = paymentCredentialOf(await lucid.wallet.address()).hash;

    const walletUTxOs = await lucid.wallet.getUtxos();

    // Using `LOVELACE_MARGIN` as the minimum required Lovelaces so that the
    // collected routing fee minus the transaction fee doesn't go below the min
    // required Lovelaces for a UTxO. TODO?
    const requiredAssets: Assets = { lovelace: LOVELACE_MARGIN };

    const selectedUtxos = selectUtxos(walletUTxOs, requiredAssets);

    if (selectedUtxos.type == "error") return selectedUtxos;

    const inputIndices = getInputUtxoIndices([utxoToSpend], selectedUtxos.data);

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
      .collectFrom(selectedUtxos.data)
      .addSignerKey(ownHash) // For collateral UTxO
      .attachSpendingValidator(validator)
      .payToContract(config.swapAddress, outputDatumHash, outputAssets)
      .complete();
    return { type: "ok", data: tx };
  } catch (error) {
    return genericCatch(error);
  }
};

export const batchSwap = async (
  lucid: Lucid,
  config: BatchSwapConfig
): Promise<Result<TxComplete>> => {
  const batchVAsRes = getBatchVAs(lucid, config.swapAddress, config.scripts);

  if (batchVAsRes.type == "error") return batchVAsRes;

  const batchVAs: BatchVAs = batchVAsRes.data;
};
