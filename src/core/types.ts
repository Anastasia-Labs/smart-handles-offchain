import {
  Address,
  Assets,
  CBORHex,
  Data,
  Network,
  OutRef,
  OutputDatum,
  RedeemerBuilder,
  TxBuilder,
  UTxO,
  Unit,
} from "@lucid-evolution/lucid";
import { AdvancedDatumFields, SimpleDatumFields } from "./contract.types.js";

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
  additionalAction?: (tx: TxBuilder, utxo: UTxO) => Promise<Result<TxBuilder>>;
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
  extraInfoDataBuilder: () => Data;
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

export type SimpleOutputDatumMaker = (
  inputAssets: Assets,
  inputDatum: SimpleDatumFields
) => Promise<Result<OutputDatum>>;

export type AdvancedOutputDatumMaker = (
  inputAssets: Assets,
  inputDatum: AdvancedDatumFields
) => Promise<Result<OutputDatum>>;

export type AdvancedReclaimConfig = {
  outputDatumMaker: AdvancedOutputDatumMaker;
  additionalAction: (tx: TxBuilder, utxo: UTxO) => Promise<Result<TxBuilder>>;
};

export type CommonSingle = {
  scriptCBOR: CBORHex;
  requestOutRef: OutRef;
};

export type CommonBatch = {
  stakingScriptCBOR: CBORHex;
  requestOutRefs: OutRef[];
};

export type SingleReclaimConfig = CommonSingle & {
  advancedReclaimConfig?: AdvancedReclaimConfig;
};

export type BatchReclaimConfig = CommonBatch & {
  advancedReclaimConfig?: AdvancedReclaimConfig;
};

export type SimpleRouteConfig = {
  additionalAction: (tx: TxBuilder, utxo: UTxO) => Promise<Result<TxBuilder>>;
  outputDatumMaker: SimpleOutputDatumMaker;
};

export type AdvancedRouteConfig = {
  additionalAction: (tx: TxBuilder, utxo: UTxO) => Promise<Result<TxBuilder>>;
  outputDatumMaker: AdvancedOutputDatumMaker;
};

export type SingleRouteConfig = CommonSingle & {
  routeAddress: Address;
  simpleRouteConfig?: SimpleRouteConfig;
  advancedRouteConfig?: AdvancedRouteConfig;
};

export type BatchRouteConfig = CommonBatch & {
  routeAddress: Address;
  simpleRouteConfig?: SimpleRouteConfig;
  advancedRouteConfig?: AdvancedRouteConfig;
};

export type CliTarget = "Single" | "Batch";

export type CliRequestInfo = {
  lovelace: bigint;
  asset: Assets;
  markOwner?: true;
  routerFee: bigint;
  reclaimRouterFee: bigint;
  extraConfig?: { [key: string]: any };
};

export interface CliConfig {
  network?: Network;
  pollingInterval?: number;
  scriptCBOR: CBORHex;
  scriptTarget: CliTarget;
  routeDestination: Address;
  advancedReclaimConfig?: AdvancedReclaimConfig;
  simpleRouteConfig?: SimpleRouteConfig;
  advancedRouteConfig?: AdvancedRouteConfig;
  advancedRouteRequestMaker?: (
    requestInfo: CliRequestInfo
  ) => Promise<Result<RouteRequest>>;
}
