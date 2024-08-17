import {
  Address,
  Assets,
  CBORHex,
  OutRef,
  OutputDatum,
  RedeemerBuilder,
  TxBuilder,
  UTxO,
  Unit,
} from "@lucid-evolution/lucid";
import { SmartHandleDatum } from "./contract.types.js";

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

/**
 * Intermediary datatype for mapping an input UTxO to its corresponding output
 * datum and output assets.
 *
 * If `outputAssets` is not set, it'll be handled by change output.
 */
export type InputUTxOAndItsOutputInfo = {
  utxo: UTxO;
  redeemerBuilder: RedeemerBuilder;
  outputAddress?: Address;
  scriptOutput?: {
    outputAssets: Assets;
    outputDatum: OutputDatum;
  };
};

/**
 * Assumes selected wallet as `owner`
 */
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

export type SimpleReclaimConfig = {
  requestOutRef: OutRef;
};

export type AdvancedReclaimConfig = SimpleReclaimConfig & {
  outputDatum: OutputDatum;
  extraLovelacesToBeLocked: bigint;
  additionalAction: (tx: TxBuilder, utxo: UTxO) => TxBuilder;
};

export type ReclaimConfig =
  | { kind: "simple"; data: SimpleReclaimConfig }
  | { kind: "advanced"; data: AdvancedReclaimConfig };

export type SingleReclaimConfig = {
  scriptCBOR: CBORHex;
  reclaimConfig: ReclaimConfig;
};

export type BatchReclaimConfig = {
  stakingScriptCBOR: CBORHex;
  reclaimConfigs: ReclaimConfig[];
};

export type OutputDatumMaker = (
  inputAssets: Assets,
  inputDatum: SmartHandleDatum
) => Promise<Result<OutputDatum>>;

export type RouteConfig = {
  requestOutRef: OutRef;
  extraLovelacesToBeLocked: bigint;
  outputDatumMaker: OutputDatumMaker;
  additionalAction: (tx: TxBuilder, utxo: UTxO) => TxBuilder;
};

export type SingleRouteConfig = {
  scriptCBOR: CBORHex;
  routeAddress: Address;
  routeConfig: RouteConfig;
};

export type BatchRouteConfig = {
  stakingScriptCBOR: CBORHex;
  routeAddress: Address;
  routeConfigs: RouteConfig[];
};
