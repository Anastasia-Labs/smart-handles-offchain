import { Address, Lucid, UTxO } from "@anastasia-labs/lucid-cardano-fork";
import {
  parseSafeDatum,
  toAddress,
  getSingleValidatorVA,
  getBatchVAs,
} from "../core/utils/index.js";
import {
  ReadableUTxO,
  FetchSingleRequestConfig,
  FetchBatchRequestConfig,
  FetchUsersSingleRequestConfig,
} from "../core/types.js";
import { SmartHandleDatum } from "../core/contract.types.js";

export const getSingleRequestUTxOs = async (
  lucid: Lucid,
  config: FetchSingleRequestConfig
): Promise<ReadableUTxO<SmartHandleDatum>[]> => {
  const vaRes = getSingleValidatorVA(
    lucid,
    config.swapAddress,
    config.spendingScript
  );

  if (vaRes.type === "error") return [];

  try {
    const requestUTxOs: UTxO[] = await lucid.utxosAt(vaRes.data.address);

    return requestUTxOs.flatMap((utxo) => {
      const result = parseSafeDatum<SmartHandleDatum>(
        lucid,
        utxo.datum,
        SmartHandleDatum
      );

      if (result.type == "right") {
        return {
          outRef: {
            txHash: utxo.txHash,
            outputIndex: utxo.outputIndex,
          },
          datum: result.value,
          assets: utxo.assets,
        };
      } else {
        return [];
      }
    });
  } catch (_e) {
    return [];
  }
};

export const userSingleRequestUTxOs = async (
  lucid: Lucid,
  config: FetchUsersSingleRequestConfig
): Promise<ReadableUTxO<SmartHandleDatum>[]> => {
  try {
    const allUTxOs = await getSingleRequestUTxOs(
      lucid,
      singleUsersConfigToGenerigConfig(config)
    );
    return allUTxOs.flatMap((utxo: ReadableUTxO<SmartHandleDatum>) => {
      const ownerAddress: Address = toAddress(utxo.datum.owner, lucid);
      if (ownerAddress == config.owner) {
        return {
          outRef: {
            txHash: utxo.outRef.txHash,
            outputIndex: utxo.outRef.outputIndex,
          },
          datum: utxo.datum,
          assets: utxo.assets,
        };
      } else {
        return [];
      }
    });
  } catch (_e) {
    return [];
  }
};

const singleUsersConfigToGenerigConfig = (
  config: FetchUsersSingleRequestConfig
): FetchSingleRequestConfig => {
  return {
    swapAddress: config.swapAddress,
    spendingScript: config.spendingScript,
  };
};
