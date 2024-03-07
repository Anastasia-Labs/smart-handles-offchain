import {
  Constr,
  Data,
  Lucid,
  TxComplete,
  paymentCredentialOf,
} from "@anastasia-labs/lucid-cardano-fork";
import { BatchVAs, getBatchVAs, parseSafeDatum } from "../core/utils/index.js";
import { Result, BatchReclaimConfig } from "../core/types.js";
import { SmartHandleDatum } from "../core/contract.types.js";

export const reclaim = async (
  lucid: Lucid,
  config: BatchReclaimConfig
): Promise<Result<TxComplete>> => {
  const batchVAsRes = getBatchVAs(lucid, config.swapAddress, {
    spending: config.scripts.spending,
    staking: config.scripts.staking,
  });

  if (batchVAsRes.type == "error") return batchVAsRes;

  const batchVAs: BatchVAs = batchVAsRes.data;

  const utxosToSpend = await lucid.utxosByOutRef(config.requestOutRefs);

  if (!utxosToSpend || utxosToSpend.length < 1)
    return { type: "error", error: new Error("No UTxO with that TxOutRef") };

  if (utxosToSpend.some((u) => !u.datum))
    return {
      type: "error",
      error: new Error("One or more UTxO(s) with missing datum encountered"),
    };

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
      .attachSpendingValidator(va.validator)
      .complete();
    return { type: "ok", data: tx };
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };
    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};
