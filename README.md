<!-- vim-markdown-toc GFM -->
# Table of Contents

* [Contract Logic](#contract-logic)
* [How to Use](#how-to-use)
    * [Install Package](#install-package)
    * [Submit One or More Request UTxOs](#submit-one-or-more-request-utxos)
    * [Fetch Swap Requests](#fetch-swap-requests)
    * [Reclaim a Swap Request](#reclaim-a-swap-request)
    * [Performing a Swap by Routing Agent](#performing-a-swap-by-routing-agent)
* [Future](#future)

<!-- vim-markdown-toc -->

# Off-Chain SDK for Smart Handles

Smart Handles is a customizable Cardano contract that allows users to circumvent
frontend of their favorite DEXs for submitting a swap request. It does so by
acting as an intermediary and offering a "router fee" to incentivise arbitrary
entities for carrying out the swaps.

## Contract Logic

A valid UTxO for the contract address should have at most 2 assets, and a datum
that carries 3 values:
1. Address of the owner
2. Policy ID of the desired asset
3. Token name of the desired asset

The `Reclaim` endpoint only checks for the consent of its owner.

The `Swap` endpoint validates a few things:
1. Index of the UTxO matches the one specified by the redeemer
2. The reproduced UTxO is going to the swap address (specified as a parameter)
3. The new UTxO at the swap address carries an identical value with the router
   fee deduced
4. Exactly 1 UTxO is getting spent from the smart handle script (the batch
   version doesn't require this)
5. The custom validation function passes (this is the customizable part of the
   contract, currently implemented for Minswap)

The off-chain side determines the offered asset by inspecting the input value:
if there is only one asset (i.e. Ada), it'll consider the request as a simple
token purchase. However, if there are 2 assets, the other asset will be
considered as the offer. It'll fail if there are more assets.

## How to Use

All endpoints provide two variants: `single` and `batch`. These two correspond
to two different script addresses. The former works for single
request/reclaim/swaps per transaction, while the latter allows batch actions.

Both variants of endpoints return a `Result` that, if successful, carries the
completed transaction (i.e. ready to be signed and submitted).

### Install Package
```sh
npm install @anastasia-labs/smart-handles-offchain
```
or:

```sh
pnpm install @anastasia-labs/smart-handles-offchain
```

### Submit One or More Request UTxOs

To produce a valid UTxO at the smart script address, use either `singleRequest`
or `batchRequest` function. For each request, you'll need to provide a
`SwapRequest`:

```ts
type SwapRequest = {
  fromAsset: Asset;
  quantity: bigint;
  toAsset: Asset;
}
```

Where `Asset` can either be `"lovelace"` or `Unit` of a token (which is the
concatenation of its policy ID and its token name in hex), and `quantity` is the
amount of the offered asset.

Here's an example for producing an Ada to MIN request UTxO:

```ts
import {
  singleRequest,
  SingleRequestConfig,
  toUnit,
  MIN_SYMBOL_PREPROD,
  MIN_TOKEN_NAME,
} from "@anastasia-labs/smart-handles-offchain";

const requestConfig: SingleRequestConfig = {
  swapRequest: {
    fromAsset: "lovelace",
    quantity: 50_000_000n,
    toAsset: toUnit(MIN_SYMBOL_PREPROD, MIN_TOKEN_NAME,
  },
  testnet: true,
};

// Assuming `lucid` is already set up for the user
const requestTxUnsigned = singleRequest(lucid, requestConfig);

if (requestTxUnsigned.type == "error") {
  throw requestTxUnsigned.error;
} else {
  const requestTxSigned = await requestTxUnsigned.data.sign().complete();
  const requestTxHash = await requestTxSigned.submit();
  await lucid.awaitTx(requestTxHash);
}
```

### Fetch Swap Requests

You can either fetch all the request UTxOs (at either `single` or `batch` scripts),
or only grab the ones belonging to a specific user.

```ts
import { fetchSingleRequestUTxOs } from "@anastasia-labs/smart-handles-offchain";

const allSingleRequests = await fetchSingleRequestUTxOs(
  lucid, // Selected wallet here doesn't matter
  true   // Indicates that it is intended for testnet (preprod)
);
```

### Reclaim a Swap Request

Any user can retract from their swap requests at any time. Here's a batch
example:

```ts
import {
  batchReclaim,
  BatchReclaimConfig,
  fetchUsersBatchRequestUTxOs,
} from "@anastasia-labs/smart-handles-offchain";

// Assuming `lucid` is already set up for the user
const usersAddress = await lucid.wallet.address();

const usersUTxOs = await fetchUsersBatchRequestUTxOs(
  lucid,        // Here selected wallet in `lucid` doesn't matter
  usersAddress,
  true          // For testnet
);

const reclaimConfig: BatchReclaimConfig = {
  requestOutRefs: usersUTxOs.map(u => u.outRef),
  testnet: true,
};

// This instance of `lucid` needs to belong to the user
const reclaimTxUnsigned = await batchReclaim(lucid, reclaimConfig);

// ...plus further steps for submitting the transaction.
```

### Performing a Swap by Routing Agent

Anyone can spend a smart handle UTxO as long as they perform the requested swap
properly. The `ROUTER_FEE` is for incentivising third parties for carrying out
swaps.

```ts
import {
  batchSwap,
  BatchSwapConfig,
  fetchBatchRequestUTxOs,
} from "@anastasia-labs/smart-handles-offchain";

const allUTxOs = await fetchBatchRequestUTxOs(lucid, true);

const swapConfig: BatchSwapConfig = {
  swapConfig: {
    blockfrostKey: "routing agent's blockfrost key",
    poolId: "pool ID or token name of the corresponding LP token",
    slippageTolerance: 20n,
  },
  requestOutRefs: allUTxOs.map(u => u.outRef),
  testnet: true,
};

// Assuming `lucid` is set up for the routing agent
const swapTxUnsigned = await batchSwap(lucid, swapConfig);

// ...plus further steps for submitting the transaction.
```

## Future

While this SDK is currently curated for working with Minswap V1, in near future
it'll also offer interfaces for providing customized variants of the base
contract. Meaning for example choosing between other DEXs, or perhaps requiring
more strict validations.

Another feature to add is a more straight-forward way of finding the appropriate
pool ID for a given swap (which will grab all the pools and filter them based
on the tokens they hold).
