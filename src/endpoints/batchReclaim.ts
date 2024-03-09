import {
  Constr,
  Data,
  Lucid,
  TxComplete,
  UTxO,
  paymentCredentialOf,
} from "@anastasia-labs/lucid-cardano-fork";
import {
  BatchVAs,
  getBatchVAs,
  parseSafeDatum,
  printUTxOOutRef,
  sumUtxoAssets,
} from "../core/utils/index.js";
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
    return {
      type: "error",
      error: new Error("None of the specified UTxOs could be found"),
    };

  const inputAssets = sumUtxoAssets(utxosToSpend);

  if (!inputAssets["lovelace"])
    return {
      type: "error",
      error: new Error("Not enough Lovelaces found in script inputs"),
    };

  try {
    const ownHash = paymentCredentialOf(await lucid.wallet.address()).hash;

    const badUTxOErrorMsgs: string[] = [];

    utxosToSpend.forEach((u: UTxO) => {
      const datum = parseSafeDatum(lucid, u.datum, SmartHandleDatum);
      if (datum.type == "left") {
        badUTxOErrorMsgs.push(`${printUTxOOutRef(u)}: ${datum.value}`);
      } else {
        const correctUTxO =
          "PublicKeyCredential" in datum.value.owner.paymentCredential &&
          datum.value.owner.paymentCredential.PublicKeyCredential[0] == ownHash;
        if (!correctUTxO)
          badUTxOErrorMsgs.push(
            `${printUTxOOutRef(u)}: This UTxO does not belong to the signer`
          );
      }
    });

    if (badUTxOErrorMsgs.length > 0)
      return {
        type: "error",
        error: new Error(
          `Bad UTxOs encountered: ${badUTxOErrorMsgs.join(", ")}`
        ),
      };

    const PReclaimRedeemer = Data.to(new Constr(1, []));

    const tx = await lucid
      .newTx()
      .collectFrom(utxosToSpend, PReclaimRedeemer)
      .addSignerKey(ownHash)
      .attachSpendingValidator(batchVAs.spendVA.validator)
      .attachWithdrawalValidator(batchVAs.stakeVA.validator)
      .complete();
    return { type: "ok", data: tx };
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };
    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};
