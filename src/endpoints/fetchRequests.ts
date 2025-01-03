import { CBORHex, LucidEvolution, Network, UTxO } from "@lucid-evolution/lucid";
import { getSingleValidatorVA, getBatchVAs } from "../core/utils/index.js";

export const fetchSingleRequestUTxOs = async (
  lucid: LucidEvolution,
  network: Network,
  spendingScriptCBOR: CBORHex
): Promise<UTxO[]> => {
  const va = getSingleValidatorVA(spendingScriptCBOR, network);
  try {
    return await lucid.utxosAt(va.address);
  } catch (_e) {
    return [];
  }
};

export const fetchBatchRequestUTxOs = async (
  lucid: LucidEvolution,
  network: Network,
  stakingScriptCBOR: CBORHex
): Promise<UTxO[]> => {
  const batchVAs = getBatchVAs(stakingScriptCBOR, network);
  try {
    return await lucid.utxosAt(batchVAs.spendVA.address);
  } catch (_e) {
    return [];
  }
};
