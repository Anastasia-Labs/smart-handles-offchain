import { CBORHex, LucidEvolution, UTxO } from "@lucid-evolution/lucid";
import { getSingleValidatorVA, getBatchVAs } from "../core/utils/index.js";

export const fetchSingleRequestUTxOs = async (
  lucid: LucidEvolution,
  spendingScriptCBOR: CBORHex
): Promise<UTxO[]> => {
  const va = getSingleValidatorVA(spendingScriptCBOR, lucid.config().network);
  try {
    return await lucid.utxosAt(va.address);
  } catch (_e) {
    return [];
  }
};

export const fetchBatchRequestUTxOs = async (
  lucid: LucidEvolution,
  stakingScriptCBOR: CBORHex
): Promise<UTxO[]> => {
  const batchVAs = getBatchVAs(stakingScriptCBOR, lucid.config().network);
  try {
    return await lucid.utxosAt(batchVAs.spendVA.address);
  } catch (_e) {
    return [];
  }
};
