// IMPORTS --------------------------------------------------------------------
// {{{
import {
  Address,
  Constr,
  Data,
  LucidEvolution,
  TxSignBuilder,
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
  fromAddressToData,
  genericCatch,
  getBatchVAs,
  getSingleValidatorVA,
  validateItems,
} from "../core/utils/index.js";
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
const simpleDatumBuilder = (ownAddress: string): string => {
  // const simpleDatum: SmartHandleDatum = {
  //   Owner: fromAddress(ownAddress),
  // };
  const addrRes = fromAddressToData(ownAddress);
  if (addrRes.type == "error") {
    return Data.to(new Constr(0, [""]));
  } else {
    return Data.to(new Constr(0, [addrRes.data]));
  }
};

// Types don't seem to work here, for now we're using manual data encoding.
const advancedDatumBuilder = (
  routeRequest: AdvancedRouteRequest
): string => {
  // const advancedDatum: SmartHandleDatum = {
  //   MOwner: routeRequest.owner ? fromAddress(routeRequest.owner) : null,
  //   RouterFee: routeRequest.routerFee,
  //   ReclaimRouterFee: routeRequest.reclaimRouterFee,
  //   ExtraInfo: routeRequest.extraInfo,
  // };
  // return Data.to(advancedDatum, SmartHandleDatum);
  let addr = new Constr(1, []) as Data;
  if (routeRequest.owner) {
    const addrRes = fromAddressToData(routeRequest.owner);
    if (addrRes.type == "ok") {
      addr = new Constr(0, [addrRes.data]);
    }
  }
  const constr =
    new Constr(1, [
      addr,
      routeRequest.routerFee,
      routeRequest.reclaimRouterFee,
      routeRequest.extraInfoDataBuilder()
    ])
  return Data.to(constr);
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

  const va = getSingleValidatorVA(config.scriptCBOR, lucid.config().network);

  const validatorAddress: Address = va.address;

  const routeRequest = config.routeRequest;

  try {
    const ownAddress = await lucid.wallet().address();
    const addrRes = fromAddressToData(ownAddress);
    if (addrRes.type == "error") return addrRes;

    // Implicit assumption that who creates the transaction is the owner.
    // In case of the `Advanced` datum, the owner comes from its optional field
    // and not from the selected wallet..
    const outputDatumData =
      routeRequest.kind == "simple"
        ? simpleDatumBuilder(ownAddress)
        : advancedDatumBuilder(routeRequest.data);

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
    lucid.config().network
  );

  const targetAddress: Address = batchVAs.spendVA.address;

  const initTx = lucid.newTx();

  try {
    const ownAddress = await lucid.wallet().address();

    // Implicit assumption that who creates the transaction is the owner of all
    // requests.
    const insufficientLovelacesErrorMsgs: string[] = validateItems(
      config.routeRequests,
      (rR) => {
        if (
          !enoughLovelacesAreGettingLocked(
            rR,
            config.additionalRequiredLovelaces
          )
        )
          return INSUFFICIENT_ADA_ERROR_MSG;
        const outputDatumData =
          rR.kind == "simple"
            ? simpleDatumBuilder(ownAddress)
            : advancedDatumBuilder(rR.data);
        initTx.pay.ToContract(
          targetAddress,
          { kind: "inline", value: outputDatumData },
          rR.data.valueToLock
        );
        return undefined;
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
