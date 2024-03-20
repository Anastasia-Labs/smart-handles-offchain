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

export type FetchSingleRequestConfig = {
  swapAddress: Address;
  spendingScript: CborHex;
};

export type FetchUsersSingleRequestConfig = {
  owner: Address;
  swapAddress: Address;
  spendingScript: CborHex;
};

export type FetchBatchRequestConfig = {
  swapAddress: Address;
  scripts: {
    spending: CborHex;
    staking: CborHex;
  };
};

export type FetchUsersBatchRequestConfig = {
  owner: Address;
  swapAddress: Address;
  scripts: {
    spending: CborHex;
    staking: CborHex;
  };
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
  blockfrostKey: string;
  network: "Mainnet" | "Testnet";
  slippageTolerance: bigint;
};

export type SingleSwapConfig = {
  swapConfig: SwapConfig;
  requestOutRef: OutRef;
  spendingScript: CborHex;
};

// Same `slippageTolerance` for all request outrefs. TODO?
export type BatchSwapConfig = {
  swapConfig: SwapConfig;
  requestOutRefs: OutRef[];
  scripts: {
    spending: CborHex;
    staking: CborHex;
  };
};

export type SingleRequestConfig = {
  swapAddress: Address;
  spendingScript: CborHex;
  lovelace: bigint;
};

export type BatchRequestConfig = {
  swapAddress: Address;
  owner: Address;
  lovelaces: bigint[];
  scripts: {
    spending: CborHex;
    staking: CborHex;
  };
};
