#!/usr/bin/env node
import { main, Config, RequestInfo } from "@anastasia-labs/smart-handles-agent";
import {
  AdvancedRouteRequest,
  Result,
  errorToString,
  genericCatch,
  ok,
} from "@anastasia-labs/smart-handles-offchain";
import { MINSWAP_ADDRESS_PREPROD } from "./constants.js";
import {
  mkRouteRequest,
  mkReclaimConfig,
  mkRouteConfig,
} from "./minswap-v1.js";
import { Command } from "@commander-js/extra-typings";
import singleScript from "./uplc/smartHandleSimple.json" with {type: "json"};

const config: Config = {
  label: "Minswap V1",
  network: "Preprod",
  pollingInterval: 10_000,
  scriptCBOR: singleScript.cborHex,
  scriptTarget: "Single",
  routeDestination: MINSWAP_ADDRESS_PREPROD,
  advancedReclaimConfig: mkReclaimConfig(),
  advancedRouteConfig: mkRouteConfig(),
  advancedRouteRequestMaker: async (
    reqInfo: RequestInfo
  ): Promise<Result<AdvancedRouteRequest>> => {
    try {
      const flattenedAssets: [string, bigint][] = Object.entries(reqInfo.asset);
      if (flattenedAssets.length > 1) {
        return {
          type: "error",
          error: new Error("Too many assets provided"),
        };
      }
      if (
        reqInfo.owner &&
        reqInfo.extraConfig &&
        reqInfo.extraConfig["toAsset"] &&
        reqInfo.extraConfig["slippageTolerance"]
      ) {
        if (typeof reqInfo.extraConfig["slippageTolerance"] !== "number") {
          return {
            type: "error",
            error: new Error("Invalid slippage tolerance encountered"),
          };
        }
        const rR = await mkRouteRequest(
          reqInfo.owner.address.bech32,
          {
            fromAsset:
              flattenedAssets.length < 1 ? "lovelace" : flattenedAssets[0][0],
            quantity:
              flattenedAssets.length < 1
                ? reqInfo.lovelace
                : flattenedAssets[0][1],
            toAsset: reqInfo.extraConfig["toAsset"],
            slippageTolerance: BigInt(reqInfo.extraConfig["slippageTolerance"]),
          },
          "Preprod",
          flattenedAssets.length < 1
            ? BigInt(Math.round(Number(reqInfo.lovelace) / 40))
            : flattenedAssets[0][1]
        );
        if (rR.type == "error") return rR;
        if (rR.data.kind == "simple") {
          return {
            type: "error",
            error: new Error('Request builder made a "simple" request config'),
          };
        }
        return ok(rR.data.data);
      } else {
        return {
          type: "error",
          error: new Error("Extra required config was not provided"),
        };
      }
    } catch (e) {
      return genericCatch(e);
    }
  },
};

const program: Command = main(config);

await program
  .parseAsync(process.argv)
  .catch((e: any) => console.log(errorToString(e)));
