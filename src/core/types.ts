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

export type SingleRequestConfig = {
  lovelace: bigint;
  testnet?: boolean;
};

export type BatchRequestConfig = {
  lovelaces: bigint[];
  testnet?: boolean;
};

export type SingleReclaimConfig = {
  requestOutRef: OutRef;
  testnet?: boolean;
};

export type BatchReclaimConfig = {
  requestOutRefs: OutRef[];
  testnet?: boolean;
};

export type SwapConfig = {
  blockfrostKey: string;
  asset: AssetClass;
  poolId: string;
  slippageTolerance: bigint;
};

export type SingleSwapConfig = {
  swapConfig: SwapConfig;
  requestOutRef: OutRef;
  testnet?: boolean;
};

// Same `slippageTolerance` for all request outrefs. TODO?
export type BatchSwapConfig = {
  swapConfig: SwapConfig;
  requestOutRefs: OutRef[];
  testnet?: boolean;
};
