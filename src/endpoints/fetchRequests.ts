import { Address, LucidEvolution, Network, UTxO } from "@lucid-evolution/lucid";
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
  lucid: LucidEvolution,
  network: Network,
): Promise<SmartUTxO[]> => {
  const vaRes = getSingleValidatorVA(network);

  if (vaRes.type === "error") return [];

  try {
    return await fetchUTxOsAt(lucid, vaRes.data.address);
  } catch (_e) {
    return [];
  }
};

export const fetchUsersSingleRequestUTxOs = async (
  lucid: LucidEvolution,
  usersAddress: Address,
  network: Network
): Promise<SmartUTxO[]> => {
  try {
    const allUTxOs = await fetchSingleRequestUTxOs(lucid, network);
    return allUTxOs.flatMap((utxo: SmartUTxO) => {
      const ownerAddress: Address = toAddress(utxo.datum.owner, network);
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
  lucid: LucidEvolution,
  network: Network
): Promise<SmartUTxO[]> => {
  const batchVAsRes = getBatchVAs(network);

  if (batchVAsRes.type === "error") return [];

  try {
    return await fetchUTxOsAt(lucid, batchVAsRes.data.spendVA.address);
  } catch (_e) {
    return [];
  }
};

export const fetchUsersBatchRequestUTxOs = async (
  lucid: LucidEvolution,
  usersAddress: Address,
  network: Network
): Promise<SmartUTxO[]> => {
  try {
    const allUTxOs = await fetchBatchRequestUTxOs(lucid, network);
    return keepUsersUTxOs(allUTxOs, usersAddress, network);
  } catch (_e) {
    return [];
  }
};

const fetchUTxOsAt = async (
  lucid: LucidEvolution,
  addr: Address
): Promise<SmartUTxO[]> => {
  try {
    const requestUTxOs: UTxO[] = await lucid.utxosAt(addr);

    return requestUTxOs.flatMap((utxo) => {
      const result = parseSafeDatum<SmartHandleDatum>(
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
  allUTxOs: SmartUTxO[],
  user: Address,
  network: Network,
): SmartUTxO[] => {
  return allUTxOs.flatMap((utxo: SmartUTxO) => {
    const ownerAddress: Address = toAddress(utxo.datum.owner, network);
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
