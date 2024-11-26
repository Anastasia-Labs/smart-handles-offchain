// IMPORTS --------------------------------------------------------------------
// {{{
import {
  Address,
  Constr,
  Data,
  DatumJson,
  LucidEvolution,
  TxSignBuilder,
  datumJsonToCbor,
} from "@lucid-evolution/lucid";
import { INSUFFICIENT_ADA_ERROR_MSG, ROUTER_FEE } from "../core/constants.js";
import {
  Result,
  BatchRequestConfig,
  SingleRequestConfig,
  RouteRequest,
  AdvancedRouteRequest,
} from "../core/types.js";
import {
  collectErrorMsgs,
  enoughLovelacesAreInAssets,
  errorToString,
  fromAddressToData,
  fromAddressToDatumJson,
  genericCatch,
  getBatchVAs,
  getSingleValidatorVA,
  ok,
  validateItems,
} from "../core/utils/index.js";
import { TSRequiredMint } from "../index.js";
// }}}
// ----------------------------------------------------------------------------

// UTILITY FUNCTIONS ----------------------------------------------------------
// {{{
const enoughLovelacesAreGettingLocked = (
  routeRequest: RouteRequest,
  additionalRequiredLovelaces: bigint
): boolean => {
  if (routeRequest.kind == "simple") {
    return enoughLovelacesAreInAssets(
      routeRequest.data.valueToLock,
      ROUTER_FEE
    );
  } else {
    return enoughLovelacesAreInAssets(
      routeRequest.data.valueToLock,
      additionalRequiredLovelaces +
        BigInt(
          Math.max(
            Number(routeRequest.data.routerFee),
            Number(routeRequest.data.reclaimRouterFee)
          )
        )
    );
  }
};

// Types don't seem to work here, for now we're using manual data encoding.
const simpleDatumBuilder = (ownAddress: string): Result<string> => {
  try {
    // const simpleDatum: SmartHandleDatum = {
    //   Owner: fromAddress(ownAddress),
    // };
    const addrRes = fromAddressToData(ownAddress);
    if (addrRes.type == "error") return addrRes;
    return ok(Data.to(new Constr(0, [addrRes.data])));
  } catch (e) {
    return genericCatch(e);
  }
};

// Types don't seem to work here, for now we're using manual data encoding.
const advancedDatumBuilder = (routeRequest: AdvancedRouteRequest): Result<string> => {
  // const advancedDatum: SmartHandleDatum = {
  //   MOwner: routeRequest.owner ? fromAddress(routeRequest.owner) : null,
  //   RouterFee: routeRequest.routerFee,
  //   ReclaimRouterFee: routeRequest.reclaimRouterFee,
  //   ExtraInfo: routeRequest.extraInfo,
  // };
  // return Data.to(advancedDatum, SmartHandleDatum);
  try {
    let addr: DatumJson = { constructor: 1, fields: [] };
    if (routeRequest.owner) {
      const addrRes = fromAddressToDatumJson(routeRequest.owner);
      if (addrRes.type == "ok") {
        addr = { constructor: 0, fields: [addrRes.data] };
      }
    }
    const reqMintToConstr = (reqMint: TSRequiredMint | null): DatumJson => {
      if (reqMint === null) {
        return {
          constructor: 1,
          fields: [],
        };
      } else {
        return {
          constructor: 0,
          fields: [
            { bytes: reqMint.policyId },
            { bytes: reqMint.tokenName },
          ],
        };
      }
    };
    const constr = {
      constructor: 1,
      fields: [
        addr,
        { int: Number(routeRequest.routerFee) },
        { int: Number(routeRequest.reclaimRouterFee) },
        reqMintToConstr(routeRequest.routeRequiredMint),
        reqMintToConstr(routeRequest.reclaimRequiredMint),
        routeRequest.extraInfoDataBuilder(),
      ],
    };
    return ok(datumJsonToCbor(constr));
  } catch (e) {
    return genericCatch(e);
  }
};
// }}}
// ----------------------------------------------------------------------------

export const singleRequest = async (
  lucid: LucidEvolution,
  config: SingleRequestConfig
): Promise<Result<TxSignBuilder>> => {
  // {{{
  if (
    !enoughLovelacesAreGettingLocked(
      config.routeRequest,
      config.additionalRequiredLovelaces
    )
  )
    return {
      type: "error",
      error: new Error(INSUFFICIENT_ADA_ERROR_MSG),
    };

  const va = getSingleValidatorVA(config.scriptCBOR, config.network);

  const validatorAddress: Address = va.address;

  const routeRequest = config.routeRequest;

  try {
    const ownAddress = await lucid.wallet().address();
    const addrRes = fromAddressToDatumJson(ownAddress);
    if (addrRes.type == "error") return addrRes;

    // Implicit assumption that who creates the transaction is the owner.
    // In case of the `Advanced` datum, the owner comes from its optional field
    // and not from the selected wallet..
    const outputDatumDataRes =
      routeRequest.kind == "simple"
        ? simpleDatumBuilder(ownAddress)
        : advancedDatumBuilder(routeRequest.data);
    if (outputDatumDataRes.type == "error") return outputDatumDataRes;
    const outputDatumData = outputDatumDataRes.data;
    const tx = await lucid
      .newTx()
      .pay.ToContract(
        validatorAddress,
        { kind: "inline", value: outputDatumData },
        routeRequest.data.valueToLock
      )
      .complete();
    return { type: "ok", data: tx };
  } catch (error) {
    return genericCatch(error);
  }
  // }}}
};

export const batchRequest = async (
  lucid: LucidEvolution,
  config: BatchRequestConfig
): Promise<Result<TxSignBuilder>> => {
  // {{{
  const batchVAs = getBatchVAs(
    config.stakingScriptCBOR,
    config.network
  );
  const targetAddress: Address = batchVAs.spendVA.address;

  const initTx = lucid.newTx();

  try {
    const ownAddress = await lucid.wallet().address();

    // Implicit assumption that who creates the transaction is the owner of all
    // requests.
    const insufficientLovelacesErrorMsgs: string[] = validateItems(
      config.routeRequests,
      (rR: RouteRequest) => {
        if (
          !enoughLovelacesAreGettingLocked(
            rR,
            config.additionalRequiredLovelaces
          )
        )
          return INSUFFICIENT_ADA_ERROR_MSG;
        const outputDatumDataRes =
          rR.kind == "simple"
            ? simpleDatumBuilder(ownAddress)
            : advancedDatumBuilder(rR.data);
        if (outputDatumDataRes.type == "error") {
          return errorToString(outputDatumDataRes.error);
        }
        const outputDatumData = outputDatumDataRes.data;

        try {
          initTx.pay.ToContract(
            targetAddress,
            { kind: "inline", value: outputDatumData },
            rR.data.valueToLock
          );
          return undefined;
        } catch (e) {
          return errorToString(e);
        }
      },
      true
    );

    if (insufficientLovelacesErrorMsgs.length > 0)
      return {
        type: "error",
        error: collectErrorMsgs(
          insufficientLovelacesErrorMsgs,
          "Bad request(s) encountered"
        ),
      };

    const tx = await initTx.complete();

    return { type: "ok", data: tx };
  } catch (error) {
    return genericCatch(error);
  }
  // }}}
};
