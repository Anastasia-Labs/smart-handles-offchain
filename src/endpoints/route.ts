// IMPORTS --------------------------------------------------------------------
// {{{
import {
  Assets,
  Constr,
  Data,
  LucidEvolution,
  TxSignBuilder,
  Address,
  UTxO,
  OutputDatum,
} from "@lucid-evolution/lucid";
import {
  LOVELACE_MARGIN,
  ROUTER_FEE,
} from "../core/constants.js";
import { SmartHandleDatum } from "../core/contract.types.js";
import {
  BatchRouteConfig,
  Result,
  SingleRouteConfig,
  RouteConfig,
  InputUTxOAndItsOutputInfo,
} from "../core/types.js";
import {
  collectErrorMsgs,
  errorToString,
  genericCatch,
  getBatchVAs,
  getSingleValidatorVA,
  parseSafeDatum,
  printUTxOOutRef,
  reduceLovelacesOfAssets,
  selectUtxos,
  validateItems,
} from "../core/utils/index.js";
// }}}
// ----------------------------------------------------------------------------

// UTILITY FUNCTIONS ----------------------------------------------------------
// {{{
/**
 * Given a UTxO and its corresponding `RouteConfig`, this function returns an
 * `InputUTxOAndItsOutputInfo` which carries enough information for the tx
 * builder to spend the UTxO with a valid redeemer, and produce a UTxO with a
 * proper datum attached at `routeAddress`.
 *
 * @param utxo - The UTxO about to be spent
 * @param routeConfig - `simple` or `advanced` route config
 * @param routeAddress - Routing address of smart handles instance
 * @param forSingle - Flag to distinguish between single or batch variants
 */
const utxoToOutputInfo = (
  utxo: UTxO,
  routeConfig: RouteConfig,
  routeAddress: Address,
  forSingle: boolean
): Result<InputUTxOAndItsOutputInfo> => {
  // {{{
  const datum = parseSafeDatum(utxo.datum, SmartHandleDatum);
  if (datum.type == "left")
    return { type: "error", error: new Error(datum.value) };
  const smartHandleDatum = datum.value;

  const configMatchesUTxO =
    routeConfig.data.requestOutRef.txHash === utxo.txHash &&
    routeConfig.data.requestOutRef.outputIndex === utxo.outputIndex;
  if (!configMatchesUTxO) {
    return {
      type: "error",
      error: new Error(
        "Provided reclaim config does not correspond to the provided UTxO."
      ),
    };
  }

  let outputAssetsRes: Result<Assets>;
  let outputDatumRes: Result<OutputDatum>;
  if (routeConfig.kind == "simple" && "owner" in smartHandleDatum) {
    outputAssetsRes = reduceLovelacesOfAssets(utxo.assets, ROUTER_FEE);
    outputDatumRes = routeConfig.data.outputDatumMaker(
      utxo.assets,
      smartHandleDatum
    );
  } else if (routeConfig.kind == "advanced" && "mOwner" in smartHandleDatum) {
    outputAssetsRes = reduceLovelacesOfAssets(
      utxo.assets,
      smartHandleDatum.routerFee
    );
    outputDatumRes = routeConfig.data.outputDatumMaker(
      utxo.assets,
      smartHandleDatum
    );
  } else {
    return {
      type: "error",
      error: new Error(
        "Mismatch of UTxO and `ReclaimConfig`: One is `Simple` while the other is `Advanced`."
      ),
    };
  }
  if (outputAssetsRes.type == "error") return outputAssetsRes;
  if (outputDatumRes.type == "error") return outputDatumRes;

  return {
    type: "ok",
    data: {
      utxo,
      redeemerBuilder: {
        kind: "self",
        makeRedeemer: (ownIndex) =>
          Data.to(new Constr(0, forSingle ? [ownIndex, 0n] : [])),
      },
      outputAddress: routeAddress,
      scriptOutput: {
        outputAssets: outputAssetsRes.data,
        outputDatum: outputDatumRes.data,
      },
    },
  };
  // }}}
};
// }}}
// ----------------------------------------------------------------------------

export const singleRoute = async (
  lucid: LucidEvolution,
  config: SingleRouteConfig
): Promise<Result<TxSignBuilder>> => {
  // {{{
  const network = lucid.config().network;
  const va = getSingleValidatorVA(config.scriptCBOR, network);

  try {
    const [utxoToSpend] = await lucid.utxosByOutRef([
      config.routeConfig.data.requestOutRef,
    ]);

    if (!utxoToSpend)
      return { type: "error", error: new Error("No UTxO with that TxOutRef") };

    const walletUTxOs = await lucid.wallet().getUtxos();

    const feeUTxOsRes = selectUtxos(walletUTxOs, { lovelace: LOVELACE_MARGIN });
    if (feeUTxOsRes.type == "error") return feeUTxOsRes;

    const inUTxOAndOutInfoRes = utxoToOutputInfo(
      utxoToSpend,
      config.routeConfig,
      config.routeAddress,
      true
    );

    if (inUTxOAndOutInfoRes.type == "error") return inUTxOAndOutInfoRes;

    const inOutInfo = inUTxOAndOutInfoRes.data;

    // Implicit assumption that who creates the transaction is the routing
    // agent. Therefore the change output from the spent UTxO (which is getting
    // reproduced at the swap address with `ROUTER_FEE` less Lovelaces), is
    // going to be collected by the routing agent.
    const tx = lucid
      .newTx()
      .collectFrom([utxoToSpend], inOutInfo.redeemerBuilder)
      .collectFrom(feeUTxOsRes.data)
      .attach.SpendingValidator(va.validator)
      .pay.ToContract(
        config.routeAddress,
        inOutInfo.scriptOutput!.outputDatum,
        inOutInfo.scriptOutput!.outputAssets
      );
    const finalTx = config.routeConfig.data.additionalAction(tx, utxoToSpend);
    return { type: "ok", data: await finalTx.complete() };
  } catch (error) {
    return genericCatch(error);
  }
  // }}}
};

export const batchRoute = async (
  lucid: LucidEvolution,
  config: BatchRouteConfig
): Promise<Result<TxSignBuilder>> => {
  // {{{
  const batchVAs = getBatchVAs(
    config.stakingScriptCBOR,
    lucid.config().network
  );

  if (config.routeConfigs.length < 1)
    return { type: "error", error: new Error("No route configs provided.") };

  try {
    const utxosToSpend = await lucid.utxosByOutRef(
      config.routeConfigs.map((rC: RouteConfig) => rC.data.requestOutRef)
    );

    if (!utxosToSpend || utxosToSpend.length !== config.routeConfigs.length)
      return {
        type: "error",
        error: new Error(
          "One or more of the specified UTxOs could not be found."
        ),
      };

    const utxosAndRouteConfigs: {
      utxo: UTxO;
      routeConfig: RouteConfig;
    }[] = utxosToSpend.map((u: UTxO, i: number) => ({
      utxo: u,
      routeConfig: config.routeConfigs[i],
    }));

    const inUTxOAndOutInfos: InputUTxOAndItsOutputInfo[] = [];

    const badRouteErrorMsgs: string[] = validateItems(
      utxosAndRouteConfigs,
      ({ utxo: utxoToSpend, routeConfig }) => {
        const inUTxOAndOutInfoRes = utxoToOutputInfo(
          utxoToSpend,
          routeConfig,
          config.routeAddress,
          false,
        );

        if (inUTxOAndOutInfoRes.type == "error") {
          return `${printUTxOOutRef(utxoToSpend)}: ${errorToString(
            inUTxOAndOutInfoRes.error
          )}`;
        } else {
          inUTxOAndOutInfos.push(inUTxOAndOutInfoRes.data);
          return undefined;
        }
      }
    );

    if (badRouteErrorMsgs.length > 0)
      return {
        type: "error",
        error: collectErrorMsgs(badRouteErrorMsgs, "Bad route(s) encountered"),
      };

    let tx = lucid
      .newTx()
      .collectFrom(utxosToSpend, Data.to(new Constr(0, [])))
      .attach.SpendingValidator(batchVAs.spendVA.validator)
      .withdraw(batchVAs.stakeVA.address, 0n, {
        kind: "selected",
        inputs: utxosToSpend,
        makeRedeemer: (inputIndices) =>
          Data.to(
            new Constr(0, [
              inputIndices,
              Array.from(
                { length: inputIndices.length },
                (_, index) => index
              ).map(BigInt),
            ])
          ),
      })
      .attach.WithdrawalValidator(batchVAs.stakeVA.validator);

    inUTxOAndOutInfos.map((inOutInfo: InputUTxOAndItsOutputInfo, i: number) => {
      tx = config.routeConfigs[i].data.additionalAction(tx, inOutInfo.utxo);
    });

    return {
      type: "ok",
      data: await tx.complete(),
    };
  } catch (error) {
    return genericCatch(error);
  }
  // }}}
};
