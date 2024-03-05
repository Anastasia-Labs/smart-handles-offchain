import {
  Constr,
  Data,
  OutputData,
  Lucid,
  SpendingValidator,
  TxComplete,
  paymentCredentialOf,
} from "@anastasia-labs/lucid-cardano-fork";
import { LOVELACE_MARGIN, ROUTER_FEE } from "../core/constants.js";
import {
  AdaMinOutputDatum,
  OrderType,
  SmartHandleDatum,
} from "../core/contract.types.js";
import { Result, SwapConfig } from "../core/types.js";
import {
  getSingleValidatorScript,
  parseSafeDatum,
} from "../core/utils/index.js";

export const swap = async (
  lucid: Lucid,
  config: SwapConfig
): Promise<Result<TxComplete>> => {
  const validatorRes = getSingleValidatorScript(
    lucid,
    config.swapAddress,
    config.spendingScript
  );

  if (validatorRes.type == "error") return validatorRes;

  const validator: SpendingValidator = validatorRes.data.validator;

  const [utxoToSpend] = await lucid.utxosByOutRef([config.utxoOutRef]);

  if (!utxoToSpend)
    return { type: "error", error: new Error("No UTxO with that TxOutRef") };

  if (!utxoToSpend.datum)
    return { type: "error", error: new Error("Missing Datum") };

  if (utxoToSpend.address !== validatorRes.data.address)
    return {
      type: "error",
      error: new Error("UTxO is not coming from the script address"),
    };

  const datum = parseSafeDatum(lucid, utxoToSpend.datum, SmartHandleDatum);
  if (datum.type == "left")
    return { type: "error", error: new Error(datum.value) };

  const ownHash = paymentCredentialOf(await lucid.wallet.address()).hash;

  const ownerAddress = datum.value.owner;

  const outputOrderType: OrderType = {
    desiredAsset: {
      symbol: "e16c2dc8ae937e8d3790c7fd7168d7b994621ba14ca11415f39fed72",
      name: "4d494e",
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

  try {
    const PReclaimRedeemer = Data.to(new Constr(1, []));

    // Implicit assumption that who creates the transaction is the routing
    // agent.
    const tx = await lucid
      .newTx()
      .collectFrom([utxoToSpend], PReclaimRedeemer)
      .addSignerKey(ownHash) // For collateral UTxO
      .attachSpendingValidator(validator)
      .payToContract(config.swapAddress, outputDatumHash, outputAssets)
      .complete();
    return { type: "ok", data: tx };
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };
    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};
