import { Address, Assets, OutRef, Unit } from "@anastasia-labs/lucid-cardano-fork";

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

export type Asset = "lovelace" | Unit;

export type ReadableUTxO<T> = {
  outRef: OutRef;
  datum: T;
  assets: Assets;
};

export type SwapRequest = {
  fromAsset: Asset;
  quantity: bigint;
  toAsset: Asset;
}

export type SingleRequestConfig = {
  swapRequest: SwapRequest;
  testnet: boolean;
};

export type BatchRequestConfig = {
  swapRequests: SwapRequest[];
  testnet: boolean;
};

export type SingleReclaimConfig = {
  requestOutRef: OutRef;
  testnet: boolean;
};

export type BatchReclaimConfig = {
  requestOutRefs: OutRef[];
  testnet: boolean;
};

export type SwapConfig = {
  blockfrostKey: string;
  poolId?: string;
  slippageTolerance: bigint;
};

export type SingleSwapConfig = {
  swapConfig: SwapConfig;
  requestOutRef: OutRef;
  testnet: boolean;
};

// Same `slippageTolerance` for all request outrefs. TODO?
export type BatchSwapConfig = {
  swapConfig: SwapConfig;
  requestOutRefs: OutRef[];
  testnet: boolean;
};
