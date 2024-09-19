# Table of Contents

<!-- vim-markdown-toc GFM -->

* [Off-Chain SDK for Smart Handles](#off-chain-sdk-for-smart-handles)
    * [Endpoints](#endpoints)
        * [Fetch Requests](#fetch-requests)
        * [Request](#request)
        * [Simple Reclaim](#simple-reclaim)
        * [Routing & Advanced Reclaim](#routing--advanced-reclaim)
            * [Simple & Advanced Output Datum Makers](#simple--advanced-output-datum-makers)
            * [Required Mint Config](#required-mint-config)
            * [Additional Action](#additional-action)
            * [Common Fields](#common-fields)
            * [Advanced Reclaim Configs](#advanced-reclaim-configs)
            * [Route Configs](#route-configs)
    * [Example](#example)

<!-- vim-markdown-toc -->

# Off-Chain SDK for Smart Handles

Off-chain SDK for [Smart Handles](https://github.com/Anastasia-Labs/smart-handles),
offering configuration datatypes with corresponding transaction builders for
all possible endpoints.

## Endpoints

All endpoints provide 2 functions for 2 targets: single and batch. The script
CBOR single targets require are fully applied spending scripts, while batch
variants expect the CBOR to be that of a fully applied staking script.

The staking script's CBOR is internally applied to
the [included generic batch spending script](./src/uplc/smartHandleRouter.json) in
order to yield the batch spending script of the instance.

### Fetch Requests

Given a `LucidEvolution` object and target script, the two offered functions
query UTxOs sitting at their corresponding spending addresses.

### Request

Functions for submitting simple and/or advanced requests to the instance:

`RouteRequest` is a sum type with 2 constructors, one for the simple requests,
and one for the advanced ones:
```ts
export type TSRequiredMint = {
  policyId: PolicyId;
  tokenName: string;
};

export type SimpleRouteRequest = {
  valueToLock: Assets;
};

export type AdvancedRouteRequest = SimpleRouteRequest & {
  owner?: Address;
  routerFee: bigint;
  reclaimRouterFee: bigint;
  routeRequiredMint: TSRequiredMint | null;
  reclaimRequiredMint: TSRequiredMint | null;
  extraInfoDataBuilder: () => DatumJson;
};

export type RouteRequest =
  | { kind: "simple"; data: SimpleRouteRequest }
  | { kind: "advanced"; data: AdvancedRouteRequest };
```

Single and batch config datatypes are the following:
```ts
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
```

`additionalRequiredLovelaces` allow you to provide more safety by preventing
request submissions that can lead to the funds getting permanently locked.

### Simple Reclaim

Reclaiming a simple request only requires the signature of its owner.

Advanced reclaim is very similar to an advanced route, and therefore is expanded
upon in the next section.

### Routing & Advanced Reclaim

Before going over the configs themselves, let's look at some other common
interfaces:

#### Simple & Advanced Output Datum Makers

Both of these endpoints need to provide a function that, given input assets and
datum, returns the datum that should be attached to the produced UTxO at route
address:
```ts
export type SimpleOutputDatumMaker = (
  inputAssets: Assets,
  inputDatum: SimpleDatumFields
) => Promise<Result<OutputDatum>>;

export type AdvancedOutputDatumMaker = (
  inputAssets: Assets,
  inputDatum: AdvancedDatumFields
) => Promise<Result<OutputDatum>>;
```
As a route transaction can be consuming a simple datum, route config may be
provided with both of these datum makers.

Note the output type, `Promise<Result<OutputDatum>>`, allows your function to
be both asynchronous, and fail-able with an error message.

#### Required Mint Config

Advanced requests can require mints/burns of a single asset for both route and
reclaim. The datatype to model this is:
```ts
export type RequiredMintConfig = {
  mintQuantityFinder: (
    inputAssets: Assets,
    inputDatum: AdvancedDatumFields
  ) => Promise<Result<bigint>>;
  mintRedeemer: string;
  mintScript: Script;
};
```
Since the quantity of mint/burn can depend on the spent UTxO, a function similar
to the output datum finder has to be provided. The other two should be fairly
clear.

#### Additional Action

The underlying logic of an instance may have some extra requirements that
smart handles wrapper does not provide. This function offers instance's
off-chain to perform additional actions on a partially built transaction before
passing it to be signed (e.g. including witness of an additional staking
script):
```ts
export type AdditionalAction =
  (tx: TxBuilder, utxo: UTxO) => Promise<Result<TxBuilder>>;
```

#### Common Fields

```ts
export type CommonSingle = {
  scriptCBOR: CBORHex;
  requestOutRef: OutRef;
};

export type CommonBatch = {
  stakingScriptCBOR: CBORHex;
  requestOutRefs: OutRef[];
};
```


With these datatypes out of the way, we can now look at the advanced reclaim
and route configs:

#### Advanced Reclaim Configs

```ts
export type AdvancedReclaimConfig = {
  outputDatumMaker: AdvancedOutputDatumMaker;
  requiredMintConfig?: RequiredMintConfig;
  additionalAction: AdditionalAction;
};

export type SingleReclaimConfig = CommonSingle & {
  advancedReclaimConfig?: AdvancedReclaimConfig;
};

export type BatchReclaimConfig = CommonBatch & {
  advancedReclaimConfig?: AdvancedReclaimConfig;
};
```

#### Route Configs

First we have route configs for simple and advanced requests:
```ts
export type SimpleRouteConfig = {
  additionalAction: AdditionalAction;
  outputDatumMaker: SimpleOutputDatumMaker;
};

export type AdvancedRouteConfig = {
  outputDatumMaker: AdvancedOutputDatumMaker;
  requiredMintConfig?: RequiredMintConfig;
  additionalAction: AdditionalAction;
};
```

And use them to define single and batch route configs:
```ts
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
```

## Example

The `example` folder contains a project that not only uses this package, but
also [`smart-handles-agent`](https://github.com/Anastasia-Labs/smart-handles-agent)
to implement a full off-chain solution for
its [on-chain counterpart](https://github.com/Anastasia-Labs/smart-handles/blob/develop/src/Specialized/Minswap.hs).

The bulk of the implementation resides at [`minswap-v1.ts`](./example/src/minswap-v1.ts).

Additionally, there are also two preprod scenarios implemented
at `./example/src/scenarios/` which should give you a more practical usage of
this SDK.

Its sample transactions on preprod are linked in the
example's [`README.md`](./example/README.md).
