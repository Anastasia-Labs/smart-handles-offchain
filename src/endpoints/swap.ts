import {
  Constr,
  Data,
  Lucid,
  SpendingValidator,
  TxComplete,
  TxOutput,
  paymentCredentialOf,
} from "@anastasia-labs/lucid-cardano-fork";
import { ROUTER_FEE } from "../core/constants.js";
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

  const routerAddress = await lucid.wallet.address();

  const ownerAddress = datum.value.owner;

  const outputOrderType: OrderType = {
    desiredAsset: {
      symbol: "e16c2dc8ae937e8d3790c7fd7168d7b994621ba14ca11415f39fed72",
      name: "4d494e",
    },
    minReceive: 2000000n,
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

  const correctUTxO =
    "PublicKeyCredential" in datum.value.owner.paymentCredential &&
    datum.value.owner.paymentCredential.PublicKeyCredential[0] == ownHash;
  if (!correctUTxO)
    return {
      type: "error",
      error: new Error("Signer is not authorized to claim the UTxO"),
    };

  try {
    const PReclaimRedeemer = Data.to(new Constr(1, []));

    const tx = await lucid
      .newTx()
      .collectFrom([utxoToSpend], PReclaimRedeemer)
      .addSignerKey(ownHash)
      .attachSpendingValidator(validator)
      .payToContract(
        config.swapAddress,
        { inline: outputDatumData },
        { lovelace: 2000000n }
      )
      .payToAddress(routerAddress, { lovelace: ROUTER_FEE })
      .complete();
    return { type: "ok", data: tx };
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };
    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};
