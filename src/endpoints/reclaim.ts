import {
  Constr,
  Data,
  LucidEvolution,
  Script,
  TxSignBuilder,
  UTxO,
  paymentCredentialOf,
} from "@lucid-evolution/lucid";
import {
  BatchVAs,
  ValidatorAndAddress,
  collectErrorMsgs,
  genericCatch,
  getBatchVAs,
  getSingleValidatorVA,
  parseSafeDatum,
  printUTxOOutRef,
  validateItems,
} from "../core/utils/index.js";
import {
  Result,
  BatchReclaimConfig,
  SingleReclaimConfig,
} from "../core/types.js";
import { SmartHandleDatum } from "../core/contract.types.js";

export const singleReclaim = async (
  lucid: LucidEvolution,
  config: SingleReclaimConfig
): Promise<Result<TxSignBuilder>> => {
  const vaRes = getSingleValidatorVA(config.network);

  if (vaRes.type == "error") return vaRes;

  const va: ValidatorAndAddress = vaRes.data;

  try {
    const [utxoToSpend] = await lucid.utxosByOutRef([config.requestOutRef]);

    if (!utxoToSpend)
      return { type: "error", error: new Error("No UTxO with that TxOutRef") };

    const datum = parseSafeDatum(utxoToSpend.datum, SmartHandleDatum);
    if (datum.type == "left")
      return { type: "error", error: new Error(datum.value) };

    const ownAddress = await lucid.wallet().address();

    const correctUTxO = datumBelongsToOwner(datum.value, ownAddress);
    if (!correctUTxO) {
      return {
        type: "error",
        error: new Error(UNAUTHORIZED_OWNER_ERROR_MSG),
      };
    }
    return await buildTx(lucid, [utxoToSpend], ownAddress, va.validator);
  } catch (error) {
    return genericCatch(error);
  }
};

export const batchReclaim = async (
  lucid: LucidEvolution,
  config: BatchReclaimConfig
): Promise<Result<TxSignBuilder>> => {
  const batchVAsRes = getBatchVAs(config.network);

  if (batchVAsRes.type == "error") return batchVAsRes;

  const batchVAs: BatchVAs = batchVAsRes.data;

  try {
    const utxosToSpend = await lucid.utxosByOutRef(config.requestOutRefs);

    if (!utxosToSpend || utxosToSpend.length < 1)
      return {
        type: "error",
        error: new Error("None of the specified UTxOs could be found"),
      };

    const ownAddress = await lucid.wallet().address();

    const badUTxOErrorMsgs: string[] = validateItems(
      utxosToSpend,
      (u: UTxO) => {
        const datum = parseSafeDatum(u.datum, SmartHandleDatum);
        if (datum.type == "left") {
          return `${printUTxOOutRef(u)}: ${datum.value}`;
        } else if (!datumBelongsToOwner(datum.value, ownAddress)) {
          return `${printUTxOOutRef(u)}: ${UNAUTHORIZED_OWNER_ERROR_MSG}`;
        } else {
          return undefined;
        }
      }
    );

    if (badUTxOErrorMsgs.length > 0)
      return {
        type: "error",
        error: collectErrorMsgs(badUTxOErrorMsgs, "Bad UTxO(s) encountered"),
      };

    return await buildTx(
      lucid,
      utxosToSpend,
      ownAddress,
      batchVAs.spendVA.validator
    );
  } catch (error) {
    return genericCatch(error);
  }
};

const buildTx = async (
  lucid: LucidEvolution,
  utxosToSpend: UTxO[],
  ownAddress: string,
  validator: Script
): Promise<Result<TxSignBuilder>> => {
  try {
    const PReclaimRedeemer = Data.to(new Constr(1, []));

    const tx = await lucid
      .newTx()
      .collectFrom(utxosToSpend, PReclaimRedeemer)
      .addSigner(ownAddress)
      .attach.SpendingValidator(validator)
      .complete();
    return { type: "ok", data: tx };
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };
    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};

const datumBelongsToOwner = (
  d: SmartHandleDatum,
  ownerAddress: string
): boolean => {
  return (
    "PublicKeyCredential" in d.owner.paymentCredential &&
    d.owner.paymentCredential.PublicKeyCredential[0] ==
      paymentCredentialOf(ownerAddress).hash
  );
};

const UNAUTHORIZED_OWNER_ERROR_MSG: string =
  "Signer is not authorized to claim the UTxO";
