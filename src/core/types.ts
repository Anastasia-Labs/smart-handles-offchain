import { Assets, Network, OutRef, Unit } from "@lucid-evolution/lucid";

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
  network: Network;
};

export type BatchRequestConfig = {
  swapRequests: SwapRequest[];
  network: Network;
};

export type SingleReclaimConfig = {
  requestOutRef: OutRef;
  network: Network;
};

export type BatchReclaimConfig = {
  requestOutRefs: OutRef[];
  network: Network;
};

export type SwapConfig = {
  blockfrostKey: string;
  poolId?: string;
  slippageTolerance: bigint;
};

export type SingleSwapConfig = {
  swapConfig: SwapConfig;
  requestOutRef: OutRef;
  network: Network;
};

// Same `slippageTolerance` for all request outrefs. TODO?
export type BatchSwapConfig = {
  swapConfig: SwapConfig;
  requestOutRefs: OutRef[];
  network: Network;
};
