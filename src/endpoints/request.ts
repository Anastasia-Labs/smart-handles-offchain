import {
  Address,
  Data,
  Lucid,
  TxComplete,
} from "@anastasia-labs/lucid-cardano-fork";
import { LOVELACE_MARGIN, ROUTER_FEE } from "../core/constants.js";
import {
  SmartHandleDatum,
} from "../core/contract.types.js";
import { Result, RequestConfig } from "../core/types.js";
import {
  fromAddress,
  getSingleValidatorVA,
} from "../core/utils/index.js";

export const singleRequest = async (
  lucid: Lucid,
  config: RequestConfig
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
      error: new Error("Not enough Lovelaces are getting locked"),
    };

  const outputAssets = {
    lovelace: config.lovelace
  };
  try {
    const ownAddress = await lucid.wallet.address();

    // Implicit assumption that who creates the transaction is the owner.
    const outputDatum: SmartHandleDatum = {
      owner: fromAddress(ownAddress),
    };

    const outputDatumData = Data.to<SmartHandleDatum>(
      outputDatum,
      SmartHandleDatum,
    );

    const tx = await lucid
      .newTx()
      .payToContract(validatorAddress, outputDatumData, outputAssets)
      .complete();
    return { type: "ok", data: tx };
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };
    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};

