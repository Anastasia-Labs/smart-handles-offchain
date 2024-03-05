import {
  Constr,
  Data,
  Lucid,
  SpendingValidator,
  TxComplete,
  paymentCredentialOf,
} from "@anastasia-labs/lucid-cardano-fork";
import {
  getSingleValidatorScript,
  parseSafeDatum,
} from "../core/utils/index.js";
import { Result, ReclaimConfig } from "../core/types.js";
import { SmartHandleDatum } from "../core/contract.types.js";

export const reclaim = async (
  lucid: Lucid,
  config: ReclaimConfig
): Promise<Result<TxComplete>> => {
  const validatorRes = getSingleValidatorScript(
    config.swapAddress,
    config.spendingScript
  );

  if (validatorRes.type == "error") return validatorRes;

  const validator: SpendingValidator = validatorRes.data;

  const [utxoToSpend] = await lucid.utxosByOutRef([config.utxoOutRef]);

  if (!utxoToSpend)
    return { type: "error", error: new Error("No UTxO with that TxOutRef") };

  if (!utxoToSpend.datum)
    return { type: "error", error: new Error("Missing Datum") };

  const datum = parseSafeDatum(lucid, utxoToSpend.datum, SmartHandleDatum);
  if (datum.type == "left")
    return { type: "error", error: new Error(datum.value) };

  const ownHash = paymentCredentialOf(await lucid.wallet.address()).hash;

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
      .complete();
    return { type: "ok", data: tx };
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };
    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};