import { Address, Lucid, UTxO } from "@anastasia-labs/lucid-cardano-fork";
import {
  parseSafeDatum,
  toAddress,
  getSingleValidatorVA,
  getBatchVAs,
} from "../core/utils/index.js";
import {
  ReadableUTxO,
} from "../core/types.js";
import { SmartHandleDatum } from "../core/contract.types.js";

type SmartUTxO = ReadableUTxO<SmartHandleDatum>;

export const fetchSingleRequestUTxOs = async (
  lucid: Lucid,
  testnet?: boolean,
): Promise<SmartUTxO[]> => {
  const vaRes = getSingleValidatorVA(lucid, testnet);

  if (vaRes.type === "error") return [];

  try {
    return await fetchUTxOsAt(lucid, vaRes.data.address);
  } catch (_e) {
    return [];
  }
};

export const fetchUsersSingleRequestUTxOs = async (
  lucid: Lucid,
  usersAddress: Address,
  testnet?: boolean
): Promise<SmartUTxO[]> => {
  try {
    const allUTxOs = await fetchSingleRequestUTxOs(lucid, testnet);
    return allUTxOs.flatMap((utxo: SmartUTxO) => {
      const ownerAddress: Address = toAddress(utxo.datum.owner, lucid);
      if (ownerAddress == usersAddress) {
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

export const fetchBatchRequestUTxOs = async (
  lucid: Lucid,
  testnet?: boolean
): Promise<SmartUTxO[]> => {
  const batchVAsRes = getBatchVAs(lucid, testnet);

  if (batchVAsRes.type === "error") return [];

  try {
    return await fetchUTxOsAt(lucid, batchVAsRes.data.spendVA.address);
  } catch (_e) {
    return [];
  }
};

export const fetchUsersBatchRequestUTxOs = async (
  lucid: Lucid,
  usersAddress: Address,
  testnet?: boolean
): Promise<SmartUTxO[]> => {
  try {
    const allUTxOs = await fetchBatchRequestUTxOs(lucid, testnet);
    return keepUsersUTxOs(lucid, allUTxOs, usersAddress);
  } catch (_e) {
    return [];
  }
};

const fetchUTxOsAt = async (
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
