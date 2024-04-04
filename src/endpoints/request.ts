import {
  Address,
  Assets,
  Data,
  Lucid,
  TxComplete,
  fromUnit,
} from "@anastasia-labs/lucid-cardano-fork";
import {
  LOVELACE_MARGIN,
  MINSWAP_BATCHER_FEE,
  MINSWAP_DEPOSIT,
  ROUTER_FEE,
} from "../core/constants.js";
import { SmartHandleDatum } from "../core/contract.types.js";
import {
  Result,
  BatchRequestConfig,
  SingleRequestConfig,
  SwapRequest,
} from "../core/types.js";
import {
  collectErrorMsgs,
  errorToString,
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
  const vaRes = getSingleValidatorVA(lucid, config.testnet);

  if (vaRes.type == "error") return vaRes;

  const validatorAddress: Address = vaRes.data.address;

  const swapRequest = config.swapRequest;

  const outputAssetsRes = requestsOutputAssets(swapRequest);

  if (outputAssetsRes.type == "error") return outputAssetsRes;

  try {
    const ownAddress = await lucid.wallet.address();

    // Implicit assumption that who creates the transaction is the owner.
    const outputDatumData = datumBuilder(ownAddress, swapRequest);

    const tx = await lucid
      .newTx()
      .payToContract(
        validatorAddress,
        { inline: outputDatumData },
        outputAssetsRes.data
      )
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
  const batchVAsRes = getBatchVAs(lucid, config.testnet);

  if (batchVAsRes.type == "error") return batchVAsRes;

  const targetAddress: Address = batchVAsRes.data.spendVA.address;

  const initTx = lucid.newTx();

  try {
    const ownAddress = await lucid.wallet.address();

    // Implicit assumption that who creates the transaction is the owner of all
    // requests.
    const badRequestsErrorMsgs = validateItems(
      config.swapRequests,
      (req) => {
        const outputAssetsRes = requestsOutputAssets(req);
        if (outputAssetsRes.type == "error") {
          return `${req.fromAsset ?? "lovelace"} -> ${
            req.toAsset ?? "lovelace"
          }: ${errorToString(outputAssetsRes.error)}`;
        } else {
          const outputDatumData = datumBuilder(ownAddress, req);
          const outputAssets = outputAssetsRes.data;
          initTx.payToContract(
            targetAddress,
            { inline: outputDatumData },
            outputAssets
          );
          return undefined;
        }
      },
      true
    );

    if (badRequestsErrorMsgs.length > 0)
      return {
        type: "error",
        error: collectErrorMsgs(
          badRequestsErrorMsgs,
          "Bad request(s) encountered"
        ),
      };

    const tx = await initTx.complete();

    return { type: "ok", data: tx };
  } catch (error) {
    return genericCatch(error);
  }
};

const INSUFFICIENT_LOVELACES_ERROR_MSG =
  "Not enough Lovelaces are getting locked";

const datumBuilder = (ownAddress: string, swapRequest: SwapRequest): string => {
  const outputDatum: SmartHandleDatum = {
    owner: fromAddress(ownAddress),
    extraInfo: {
      desiredAssetSymbol:
        swapRequest.toAsset == "lovelace"
          ? ""
          : fromUnit(swapRequest.toAsset).policyId,
      desiredAssetTokenName: fromUnit(swapRequest.toAsset).assetName ?? "",
    },
  };
  return Data.to(outputDatum, SmartHandleDatum);
};

const requestsOutputAssets = (swapRequest: SwapRequest): Result<Assets> => {
  if (
    swapRequest.fromAsset == "lovelace" &&
    swapRequest.quantity <
      MINSWAP_BATCHER_FEE + MINSWAP_DEPOSIT + ROUTER_FEE + LOVELACE_MARGIN
  ) {
    return {
      type: "error",
      error: new Error(INSUFFICIENT_LOVELACES_ERROR_MSG),
    };
  }

  if (swapRequest.fromAsset == swapRequest.toAsset) {
    return {
      type: "error",
      error: new Error("Input and target assets can't be identical"),
    };
  }

  return {
    type: "ok",
    data:
      swapRequest.fromAsset == "lovelace"
        ? {
            lovelace: swapRequest.quantity,
          }
        : {
            lovelace: MINSWAP_BATCHER_FEE + MINSWAP_DEPOSIT + ROUTER_FEE,
            [swapRequest.fromAsset]: swapRequest.quantity,
          },
  };
};
