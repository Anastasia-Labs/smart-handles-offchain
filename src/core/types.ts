import {
  Assets,
  CBORHex,
  Data,
  OutRef,
  OutputDatum,
  Unit,
} from "@lucid-evolution/lucid";
import { Value } from "./contract.types.js";

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

// Assumes selected wallet as `owner`
export type SimpleRouteRequest = {
  valueToLock: Assets;
};

export type AdvancedRouteRequest = SimpleRouteRequest & {
  markWalletAsOwner: boolean;
  routerFee: bigint;
  reclaimRouterFee: bigint;
  extraInfo: CBORHex;
};

export type RouteRequest =
  | { kind: "simple"; data: SimpleRouteRequest }
  | { kind: "advanced"; data: AdvancedRouteRequest };

export type SingleRequestConfig = {
  scriptCBOR: CBORHex;
  routeRequest: RouteRequest;
  additionalRequiredLovelaces: bigint;
};

export type BatchRequestConfig = {
  stakingScriptCBOR: CBORHex;
  routeRequests: RouteRequest[];
  additionalRequiredLovelaces: bigint;
};

export type SingleReclaimConfig = {
  requestOutRef: OutRef;
};

export type BatchReclaimConfig = {
  requestOutRefs: OutRef[];
};

export type RouteConfig = {
  blockfrostKey: string;
  poolId?: string;
  slippageTolerance: bigint;
};

export type SingleRouteConfig = {
  swapConfig: RouteConfig;
  requestOutRef: OutRef;
};

// Same `slippageTolerance` for all request outrefs. TODO?
export type BatchRouteConfig = {
  routeConfig: RouteConfig;
  requestOutRefs: OutRef[];
};
