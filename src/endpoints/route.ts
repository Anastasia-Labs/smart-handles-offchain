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
  Network,
  TxBuilder,
  selectUTxOs,
  OutRef,
} from "@lucid-evolution/lucid";
import { LOVELACE_MARGIN, ROUTER_FEE } from "../core/constants.js";
import {
  AdvancedDatumFields,
  SimpleDatumFields,
} from "../core/contract.types.js";
import {
  BatchRouteConfig,
  Result,
  SingleRouteConfig,
  InputUTxOAndItsOutputInfo,
  SimpleRouteConfig,
  AdvancedRouteConfig,
} from "../core/types.js";
import {
  asyncValidateItems,
  collectErrorMsgs,
  errorToString,
  genericCatch,
  getBatchVAs,
  getOneUTxOFromWallet,
  getSingleValidatorVA,
  ok,
  printUTxOOutRef,
  reduceLovelacesOfAssets,
  selectUtxos,
  validateItems,
  validateUTxOAndConfig,
} from "../core/utils/index.js";
// }}}
// ----------------------------------------------------------------------------

// UTILITY FUNCTIONS ----------------------------------------------------------
// {{{
const outputHelper = (
  utxo: UTxO,
  forSingle: boolean,
  routeAddress: Address,
  outputAssetsRes: Result<Assets>,
  outputDatumRes: Result<OutputDatum>,
  additionalAction: (tx: TxBuilder, utxo: UTxO) => Promise<Result<TxBuilder>>
): Result<Required<InputUTxOAndItsOutputInfo>> => {
  if (outputAssetsRes.type == "error") return outputAssetsRes;
  if (outputDatumRes.type == "error") return outputDatumRes;
  return ok({
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
    additionalAction,
  });
};

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
 * @param network - It's not used here, but the abstraction would've been much
 *        more complex without it.
 */
const utxoToOutputInfo = async (
  utxo: UTxO,
  routeAddress: Address,
  simpleRouteConfig: SimpleRouteConfig | undefined,
  advancedRouteConfig: AdvancedRouteConfig | undefined,
  forSingle: boolean,
  network: Network
): Promise<Result<InputUTxOAndItsOutputInfo>> => {
  return await validateUTxOAndConfig(
    utxo,
    async (u: UTxO, simpleFields: SimpleDatumFields) => {
      // {{{
      if (simpleRouteConfig) {
        try {
          const outputAssetsRes: Result<Assets> = reduceLovelacesOfAssets(
            utxo.assets,
            ROUTER_FEE
          );
          const outputDatumRes: Result<OutputDatum> =
            await simpleRouteConfig.outputDatumMaker(utxo.assets, simpleFields);
          return outputHelper(
            u,
            forSingle,
            routeAddress,
            outputAssetsRes,
            outputDatumRes,
            simpleRouteConfig.additionalAction
          );
        } catch (e) {
          return genericCatch(e);
        }
      } else {
        return {
          type: "error",
          error: new Error("No simple route config was provided."),
        };
      }
      // }}}
    },
    async (u: UTxO, advancedFields: AdvancedDatumFields) => {
      // {{{
      if (advancedRouteConfig) {
        try {
          const outputAssetsRes = reduceLovelacesOfAssets(
            utxo.assets,
            advancedFields.routerFee
          );
          const outputDatumRes = await advancedRouteConfig.outputDatumMaker(
            u.assets,
            advancedFields
          );
          return outputHelper(
            u,
            forSingle,
            routeAddress,
            outputAssetsRes,
            outputDatumRes,
            advancedRouteConfig.additionalAction
          );
        } catch (e) {
          return genericCatch(e);
        }
      } else {
        return {
          type: "error",
          error: new Error("No advanced route config was provided."),
        };
      }
      // }}}
    },
    network
  );
};

function ensureArray<T>(input: T[] | { [k: string]: T }): T[] {
  if (Array.isArray(input)) {
    return input;
  } else {
    return Object.values(input);
  }
}
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
    const [utxoToSpend] = await lucid.utxosByOutRef([config.requestOutRef]);

    if (!utxoToSpend)
      return {
        type: "error",
        error: new Error("Failed to fetch the specified UTxO."),
      };

    const walletUTxOs = await lucid.wallet().getUtxos();

    const feeUTxOsRes = selectUtxos(walletUTxOs, { lovelace: LOVELACE_MARGIN });
    if (feeUTxOsRes.type == "error") return feeUTxOsRes;

    const inUTxOAndOutInfoRes = await utxoToOutputInfo(
      utxoToSpend,
      config.routeAddress,
      config.simpleRouteConfig,
      config.advancedRouteConfig,
      true,
      network
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
    const finalTxRes = await inOutInfo.additionalAction!(tx, utxoToSpend);
    if (finalTxRes.type == "error") return finalTxRes;
    return ok(await finalTxRes.data.complete());
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

  const requestOutRefs: OutRef[] = ensureArray(config.requestOutRefs);

  if (requestOutRefs.length < 1)
    return { type: "error", error: new Error("No request out refs provided.") };
  try {
    const utxosToSpend = await lucid.utxosByOutRef(requestOutRefs);

    if (!utxosToSpend)
      return {
        type: "error",
        error: new Error("None of the specified UTxOs could be found."),
      };

    const inUTxOAndOutInfos: InputUTxOAndItsOutputInfo[] = [];

    const badRouteErrorMsgs: string[] = await asyncValidateItems(
      utxosToSpend,
      async (utxoToSpend: UTxO) => {
        try {
          const inUTxOAndOutInfoRes = await utxoToOutputInfo(
            utxoToSpend,
            config.routeAddress,
            config.simpleRouteConfig,
            config.advancedRouteConfig,
            false,
            lucid.config().network
          );

          if (inUTxOAndOutInfoRes.type == "error") {
            return `${printUTxOOutRef(utxoToSpend)}: ${errorToString(
              inUTxOAndOutInfoRes.error
            )}`;
          } else {
            inUTxOAndOutInfos.push(inUTxOAndOutInfoRes.data);
            return undefined;
          }
        } catch (e) {
          return errorToString(e);
        }
      }
    );

    if (badRouteErrorMsgs.length > 0)
      return {
        type: "error",
        error: collectErrorMsgs(badRouteErrorMsgs, "Bad route(s) encountered"),
      };
    const redeemerBuilder = (inputIndices: bigint[]) =>
      Data.to(
        new Constr(0, [
          inputIndices,
          Array.from({ length: inputIndices.length }, (_, index) => index).map(
            BigInt
          ),
        ])
      );

    const walletsUTxOs = await lucid.wallet().getUtxos();
    const feeUTxOs = selectUTxOs(walletsUTxOs, { lovelace: BigInt(2_000_000) });

    let tx = lucid
      .newTx()
      .collectFrom(utxosToSpend, Data.to(new Constr(0, [])))
      .collectFrom(feeUTxOs)
      .attach.SpendingValidator(batchVAs.spendVA.validator)
      .withdraw(batchVAs.stakeVA.address, 0n, {
        kind: "selected",
        inputs: utxosToSpend,
        makeRedeemer: redeemerBuilder,
      })
      .attach.WithdrawalValidator(batchVAs.stakeVA.validator);

    const complementTxErrors: string[] = await asyncValidateItems(
      inUTxOAndOutInfos,
      async (inOutInfo: InputUTxOAndItsOutputInfo) => {
        try {
          const txRes = await inOutInfo.additionalAction!(tx, inOutInfo.utxo);
          if (txRes.type == "error") {
            return errorToString(txRes.error);
          } else {
            tx = txRes.data;
            tx.pay.ToContract(
              config.routeAddress,
              inOutInfo.scriptOutput!.outputDatum,
              inOutInfo.scriptOutput!.outputAssets
            );
          }
        } catch (e) {
          return errorToString(e);
        }
      },
      true
    );
    if (complementTxErrors.length > 0) {
      return {
        type: "error",
        error: collectErrorMsgs(
          complementTxErrors,
          "Additional action on one or more of the configs failed"
        ),
      };
    } else {
      return ok(await tx.complete());
    }
  } catch (error) {
    return genericCatch(error);
  }
  // }}}
};
