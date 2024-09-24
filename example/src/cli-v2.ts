#!/usr/bin/env node
import { Config } from "@anastasia-labs/smart-handles-agent";
import {
  errorToString,
  OutputDatum,
  Result,
  TxBuilder,
  UTxO,
  genericCatch,
  ok,
  Assets,
  SimpleDatumFields,
  getAddressDetails,
} from "@anastasia-labs/smart-handles-offchain";
import { main } from "@anastasia-labs/smart-handles-agent";
import * as B from "@blockfrost/blockfrost-js";
import { Command } from "@commander-js/extra-typings";
import * as M from "@minswap/sdk-v2";
import { BigNumber } from "bignumber.js";
import * as L from "lucid-cardano";
import * as C from "./constants-v2.js";
import SCRIPT_PREPROD from "./uplc/minswap-v2-single-testnet.json";

// UTILS
// {{{
export const getBFAdapter = (): Result<M.BlockfrostAdapter> => {
  // {{{
  const bfApiKey = process.env.BLOCKFROST_KEY;
  if (!bfApiKey)
    return {
      type: "error",
      error: new Error(
        "Blockfrost API key missing (expected at $BLOCKFROST_KEY)"
      ),
    };
  const bf = new B.BlockFrostAPI({
    network: "preprod",
    projectId: bfApiKey,
  });
  const bfAdapter = new M.BlockfrostAdapter({
    networkId: M.NetworkId.TESTNET,
    blockFrost: bf,
  });
  return ok(bfAdapter);
  // }}}
};

/**
 * Copied from on-chain logic. KEEP IN SYNC!
 */
const plovelacesAfterFees = (inputLovelaces: bigint): bigint => {
  return (
    inputLovelaces - C.MINSWAP_BATCHER_FEE - C.MINSWAP_DEPOSIT - C.ROUTER_FEE
  );
};

const getInputLovelaceCount = (inputAssets: Assets): Result<bigint> => {
  // {{{
  const flattenedAssets = Object.entries(inputAssets);
  if (
    flattenedAssets.length === 1 &&
    (flattenedAssets[0][0] === "" || flattenedAssets[0][0] === "lovelace")
  ) {
    return ok(plovelacesAfterFees(flattenedAssets[0][1]));
  } else {
    return {
      type: "error",
      error: new Error("Input UTxO is expected to have only ADA"),
    };
  }
  // }}}
};
// }}}

export const config: Config = {
  // {{{
  // const isMainnet = network === "Mainnet";
  label: "ADA-MIN Swap via Minswap V2",
  network: "Preprod",
  pollingInterval: 10_000,
  // scriptCBOR: isMainnet
  //   ? SCRIPT_MAINNET.cborHex
  scriptCBOR: SCRIPT_PREPROD.cborHex,
  scriptTarget: "Single",
  // routeDestination: isMainnet
  //   ? C.MINSWAP_ADDRESS_MAINNET
  routeDestination: C.MINSWAP_ADDRESS_PREPROD,
  simpleRouteConfig: {
    // {{{
    additionalAction: async (tx: TxBuilder, _utxo: UTxO) => ok(tx),
    outputDatumMaker: async (
      inputAssets: Assets,
      inputDatum: SimpleDatumFields
    ): Promise<Result<OutputDatum>> => {
      const inLovelacesRes = getInputLovelaceCount(inputAssets);
      if (inLovelacesRes.type == "error") return inLovelacesRes;
      const inLovelaces = inLovelacesRes.data;

      const lpAsset =
        // isMainnet
        //   ? {
        //       policyId: C.ADA_MIN_LP_SYMBOL_MAINNET,
        //       tokenName: C.ADA_MIN_LP_TOKEN_NAME_MAINNET,
        //     }
        {
          policyId: C.ADA_MIN_LP_SYMBOL_PREPROD,
          tokenName: C.ADA_MIN_LP_TOKEN_NAME_PREPROD,
        };

      // Set to string because of the way Minswap has implemented slippage
      // application. It is being "unsafely" parsed to a `number` farther
      // down.
      let slippageAdjustedAmount: string;

      const bfAdapterRes = getBFAdapter();
      if (bfAdapterRes.type == "error") return bfAdapterRes;
      const bfAdapter = bfAdapterRes.data;
      try {
        const slippageTolerance = new BigNumber(C.SLIPPAGE_TOLERANCE).div(100);
        const pool = await bfAdapter.getV2PoolByLp(lpAsset);
        if (!pool)
          return {
            type: "error",
            error: new Error("Failed to fetch pool"),
          };

        const amountOut = M.DexV2Calculation.calculateAmountOut({
          reserveIn: pool.reserveA,
          reserveOut: pool.reserveB,
          amountIn: inLovelaces,
          tradingFeeNumerator: pool.feeA[0],
        });

        slippageAdjustedAmount = new BigNumber(1)
          .div(new BigNumber(1).plus(slippageTolerance))
          .multipliedBy(amountOut.toString())
          .toFixed(0, BigNumber.ROUND_DOWN);
      } catch (e) {
        return genericCatch(e);
      }

      const step: M.OrderV2.SwapExactIn = {
        type: M.OrderV2.StepType.SWAP_EXACT_IN,
        direction: M.OrderV2.Direction.A_TO_B,
        killable: M.OrderV2.Killable.KILL_ON_FAILED,
        minimumReceived: BigInt(parseInt(slippageAdjustedAmount, 10)),
        swapAmount: {
          type: M.OrderV2.AmountType.SPECIFIC_AMOUNT,
          swapAmount: inLovelaces,
        },
      };

      try {
        const ownerAddressDetails = getAddressDetails(inputDatum.owner);
        if (!ownerAddressDetails.paymentCredential) {
          return {
            type: "error",
            error: new Error("Owner address in the datum was faulty"),
          };
        }
        const canceller: M.OrderV2.AuthorizationMethod = {
          type: M.OrderV2.AuthorizationMethodType.SIGNATURE,
          hash: ownerAddressDetails.paymentCredential.hash,
        };
        const receiverDatum: M.OrderV2.ExtraDatum = {
          type: M.OrderV2.ExtraDatumType.NO_DATUM,
        };
        const orderDatum: M.OrderV2.Datum = {
          canceller,
          refundReceiver: inputDatum.owner,
          refundReceiverDatum: receiverDatum,
          successReceiver: inputDatum.owner,
          successReceiverDatum: receiverDatum,
          lpAsset,
          step,
          maxBatcherFee: C.MINSWAP_BATCHER_FEE,
          expiredOptions: undefined,
        };
        const datumCBOR = L.Data.to(M.OrderV2.Datum.toPlutusData(orderDatum));
        return ok({
          kind: "inline",
          value: datumCBOR,
        });
      } catch (e) {
        return genericCatch(e);
      }
    },
    // }}}
  },
  // }}}
};

const program: Command = main(config);

await program
  .parseAsync(process.argv)
  .catch((e: any) => console.log(errorToString(e)));
