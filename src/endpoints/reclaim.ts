import {
  Constr,
  Data,
  Lucid,
  Script,
  TxComplete,
  UTxO,
  paymentCredentialOf,
} from "@anastasia-labs/lucid-cardano-fork";
import {
  BatchVAs,
  ValidatorAndAddress,
  getBatchVAs,
  getSingleValidatorVA,
  parseSafeDatum,
  printUTxOOutRef,
  sumUtxoAssets,
} from "../core/utils/index.js";
import { Result, BatchReclaimConfig, SingleReclaimConfig } from "../core/types.js";
import { SmartHandleDatum } from "../core/contract.types.js";

export const singleReclaim = async (
  lucid: Lucid,
  config: SingleReclaimConfig
): Promise<Result<TxComplete>> => {
  const vaRes = getSingleValidatorVA(
    lucid,
    config.swapAddress,
    config.spendingScript
  );

  if (vaRes.type == "error") return vaRes;

  const va: ValidatorAndAddress = vaRes.data;

  const [utxoToSpend] = await lucid.utxosByOutRef([config.requestOutRef]);

  if (!utxoToSpend)
    return { type: "error", error: new Error("No UTxO with that TxOutRef") };

  const datum = parseSafeDatum(lucid, utxoToSpend.datum, SmartHandleDatum);
  if (datum.type == "left")
    return { type: "error", error: new Error(datum.value) };

  try {
    const ownHash = paymentCredentialOf(await lucid.wallet.address()).hash;

    const correctUTxO =
      "PublicKeyCredential" in datum.value.owner.paymentCredential &&
      datum.value.owner.paymentCredential.PublicKeyCredential[0] == ownHash;
    if (!correctUTxO)
      return {
        type: "error",
        error: new Error("Signer is not authorized to claim the UTxO"),
      };
    return await helper(
      lucid,
      [utxoToSpend],
      ownHash,
      va.validator
    );
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };
    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};

export const batchReclaim = async (
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
          `Bad UTxO(s) encountered: ${badUTxOErrorMsgs.join(", ")}`
        ),
      };

    return await helper(
      lucid,
      utxosToSpend,
      ownHash,
      batchVAs.spendVA.validator
    );
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };
    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};

export const helper = async (
  lucid: Lucid,
  utxosToSpend: UTxO[],
  ownHash: string,
  validator: Script
): Promise<Result<TxComplete>> => {
  try {
    const PReclaimRedeemer = Data.to(new Constr(1, []));

    const tx = await lucid
      .newTx()
      .collectFrom(utxosToSpend, PReclaimRedeemer)
      .addSignerKey(ownHash)
      .attachSpendingValidator(validator)
      .complete();
    return { type: "ok", data: tx };
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };
    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};
