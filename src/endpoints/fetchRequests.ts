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
  FetchUsersBatchRequestConfig,
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
    return await getUTxOsAt(lucid, vaRes.data.address);
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

export const getBatchRequestUTxOs = async (
  lucid: Lucid,
  config: FetchBatchRequestConfig
): Promise<ReadableUTxO<SmartHandleDatum>[]> => {
  const batchVAsRes = getBatchVAs(lucid, config.swapAddress, config.scripts);

  if (batchVAsRes.type === "error") return [];

  try {
    return await getUTxOsAt(lucid, batchVAsRes.data.spendVA.address);
  } catch (_e) {
    return [];
  }
};

export const userBatchRequestUTxOs = async (
  lucid: Lucid,
  config: FetchUsersBatchRequestConfig,
): Promise<ReadableUTxO<SmartHandleDatum>[]> => {
  try {
    const allUTxOs = await getBatchRequestUTxOs(
      lucid,
      batchUsersConfigToGenerigConfig(config)
    );
    return keepUsersUTxOs(lucid, allUTxOs, config.owner);
  } catch (_e) {
    return [];
  }
};

const getUTxOsAt = async (
  lucid: Lucid,
  addr: Address
): Promise<ReadableUTxO<SmartHandleDatum>[]> => {
  try {
    const requestUTxOs: UTxO[] = await lucid.utxosAt(addr);

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

const keepUsersUTxOs = (
  lucid: Lucid,
  allUTxOs: ReadableUTxO<SmartHandleDatum>[],
  user: Address
): ReadableUTxO<SmartHandleDatum>[] => {
  return allUTxOs.flatMap((utxo: ReadableUTxO<SmartHandleDatum>) => {
    const ownerAddress: Address = toAddress(utxo.datum.owner, lucid);
    if (ownerAddress == user) {
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
};

const singleUsersConfigToGenerigConfig = (
  config: FetchUsersSingleRequestConfig
): FetchSingleRequestConfig => {
  return {
    swapAddress: config.swapAddress,
    spendingScript: config.spendingScript,
  };
};

const batchUsersConfigToGenerigConfig = (
  config: FetchUsersBatchRequestConfig
): FetchBatchRequestConfig => {
  return {
    swapAddress: config.swapAddress,
    scripts: config.scripts,
  };
};
