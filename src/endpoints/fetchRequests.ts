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

type SmartUTxO = ReadableUTxO<SmartHandleDatum>

export const getSingleRequestUTxOs = async (
  lucid: Lucid,
  config: FetchSingleRequestConfig
): Promise<SmartUTxO[]> => {
  const vaRes = getSingleValidatorVA(
    lucid,
    config.network,
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
): Promise<SmartUTxO[]> => {
  try {
    const allUTxOs = await getSingleRequestUTxOs(
      lucid,
      singleUsersConfigToGenerigConfig(config)
    );
    return allUTxOs.flatMap((utxo: SmartUTxO) => {
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
): Promise<SmartUTxO[]> => {
  const batchVAsRes = getBatchVAs(lucid, config.network, config.scripts);

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
): Promise<SmartUTxO[]> => {
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
): Promise<SmartUTxO[]> => {
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
  allUTxOs: SmartUTxO[],
  user: Address
): SmartUTxO[] => {
  return allUTxOs.flatMap((utxo: SmartUTxO) => {
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
    network: config.network,
    spendingScript: config.spendingScript,
  };
};

const batchUsersConfigToGenerigConfig = (
  config: FetchUsersBatchRequestConfig
): FetchBatchRequestConfig => {
  return {
    network: config.network,
    scripts: config.scripts,
  };
};
