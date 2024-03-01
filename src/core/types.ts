import { Address, Assets, OutRef } from "@anastasia-labs/lucid-cardano-fork";

export type CborHex = string;
export type RawHex = string;
export type POSIXTime = number;

export type Result<T> =
  | { type: "ok"; data: T }
  | { type: "error"; error: Error };

export type Either<L, R> =
  | { type: "left"; value: L }
  | { type: "right"; value: R };

export type AssetClass = {
  policyId: string;
  tokenName: string;
};

export type ReadableUTxO<T> = {
  outRef: OutRef;
  datum: T;
  assets: Assets;
};

export type ReclaimConfig = {
  utxoOutRef: OutRef;
  swapAddress: Address;
  spendingScript: CborHex;
};
