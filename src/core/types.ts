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

export type LimitedNetwork = "Mainnet" | "Testnet";

export type FetchSingleRequestConfig = {
  network: LimitedNetwork;
  spendingScript: CborHex;
};

export type FetchUsersSingleRequestConfig = {
  owner: Address;
  network: LimitedNetwork;
  spendingScript: CborHex;
};

export type FetchBatchRequestConfig = {
  network: LimitedNetwork;
  scripts: {
    spending: CborHex;
    staking: CborHex;
  };
};

export type FetchUsersBatchRequestConfig = {
  owner: Address;
  network: LimitedNetwork;
  scripts: {
    spending: CborHex;
    staking: CborHex;
  };
};

export type SingleReclaimConfig = {
  requestOutRef: OutRef;
  network: LimitedNetwork;
  spendingScript: CborHex;
};

export type BatchReclaimConfig = {
  requestOutRefs: OutRef[];
  network: LimitedNetwork;
  scripts: {
    spending: CborHex;
    staking: CborHex;
  };
};

export type SwapConfig = {
  blockfrostKey: string;
  network: LimitedNetwork;
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
  network: LimitedNetwork;
  spendingScript: CborHex;
  lovelace: bigint;
};

export type BatchRequestConfig = {
  network: LimitedNetwork;
  owner: Address;
  lovelaces: bigint[];
  scripts: {
    spending: CborHex;
    staking: CborHex;
  };
};
