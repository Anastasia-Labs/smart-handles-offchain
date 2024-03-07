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

export type SingleReclaimConfig = {
  requestOutRef: OutRef;
  swapAddress: Address;
  spendingScript: CborHex;
};

export type BatchReclaimConfig = {
  requestOutRefs: OutRef[];
  swapAddress: Address;
  scripts: {
    spending: CborHex;
    staking: CborHex;
  };
};

export type SwapConfig = {
  requestOutRef: OutRef;
  minReceive: bigint;
  swapAddress: Address;
  spendingScript: CborHex;
};

export type RequestConfig = {
  swapAddress: Address;
  spendingScript: CborHex;
  lovelace: bigint;
};
