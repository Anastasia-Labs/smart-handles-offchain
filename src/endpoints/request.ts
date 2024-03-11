import {
  Address,
  Data,
  Lucid,
  TxComplete,
} from "@anastasia-labs/lucid-cardano-fork";
import { LOVELACE_MARGIN, ROUTER_FEE } from "../core/constants.js";
import { SmartHandleDatum } from "../core/contract.types.js";
import {
  Result,
  BatchRequestConfig,
  SingleRequestConfig,
} from "../core/types.js";
import {
  collectErrorMsgs,
  fromAddress,
  genericCatch,
  getBatchVAs,
  getSingleValidatorVA,
  validateItems,
} from "../core/utils/index.js";

export const singleRequest = async (
  lucid: Lucid,
  config: SingleRequestConfig
): Promise<Result<TxComplete>> => {
  const vaRes = getSingleValidatorVA(
    lucid,
    config.swapAddress,
    config.spendingScript
  );

  if (vaRes.type == "error") return vaRes;

  const validatorAddress: Address = vaRes.data.address;

  if (config.lovelace < ROUTER_FEE + LOVELACE_MARGIN)
    return {
      type: "error",
      error: new Error(INSUFFICIENT_LOVELACES_ERROR_MSG),
    };

  const outputAssets = {
    lovelace: config.lovelace,
  };
  try {
    const ownAddress = await lucid.wallet.address();

    // Implicit assumption that who creates the transaction is the owner.
    const outputDatum: SmartHandleDatum = {
      owner: fromAddress(ownAddress),
    };

    const outputDatumData = Data.to<SmartHandleDatum>(
      outputDatum,
      SmartHandleDatum
    );

    const tx = await lucid
      .newTx()
      .payToContract(validatorAddress, outputDatumData, outputAssets)
      .complete();
    return { type: "ok", data: tx };
  } catch (error) {
    return genericCatch(error);
  }
};

export const batchRequest = async (
  lucid: Lucid,
  config: BatchRequestConfig
): Promise<Result<TxComplete>> => {
  const batchVAsRes = getBatchVAs(lucid, config.swapAddress, config.scripts);

  if (batchVAsRes.type == "error") return batchVAsRes;

  const targetAddress: Address = batchVAsRes.data.fullAddress;

  const initTx = lucid.newTx();

  const badLovelaceErrorMsgs = validateItems(
    config.ownersAndLovelaces,
    (onl) => {
      if (onl.lovelace < ROUTER_FEE + LOVELACE_MARGIN) {
        return `${onl.owner}: ${INSUFFICIENT_LOVELACES_ERROR_MSG}`;
      } else {
        const outputDatum: SmartHandleDatum = {
          owner: fromAddress(onl.owner),
        };
        const outputDatumData = Data.to<SmartHandleDatum>(
          outputDatum,
          SmartHandleDatum
        );
        const outputAssets = {
          lovelace: onl.lovelace,
        };
        initTx.payToContract(targetAddress, outputDatumData, outputAssets);
        return undefined;
      }
    },
    true
  );

  if (badLovelaceErrorMsgs.length > 0)
    return {
      type: "error",
      error: collectErrorMsgs(badLovelaceErrorMsgs, "Bad config encountered"),
    };

  try {
    const tx = await initTx.complete();
    return { type: "ok", data: tx };
  } catch (error) {
    return genericCatch(error);
  }
};

const INSUFFICIENT_LOVELACES_ERROR_MSG =
  "Not enough Lovelaces are getting locked";
