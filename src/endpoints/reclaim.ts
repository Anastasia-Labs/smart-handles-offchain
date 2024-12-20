// IMPORTS --------------------------------------------------------------------
// {{{
import {
  Address,
  Constr,
  Data,
  LucidEvolution,
  Network,
  TxBuilder,
  TxSignBuilder,
  UTxO,
  paymentCredentialOf,
  selectUTxOs,
} from "@lucid-evolution/lucid";
import {
  applyRequiredMint,
  asyncValidateItems,
  collectErrorMsgs,
  errorToString,
  genericCatch,
  getBatchVAs,
  getSingleValidatorVA,
  ok,
  printUTxOOutRef,
  reduceLovelacesOfAssets,
  validateUTxOAndConfig,
} from "../core/utils/index.js";
import {
  Result,
  BatchReclaimConfig,
  SingleReclaimConfig,
  InputUTxOAndItsOutputInfo,
  AdvancedReclaimConfig,
} from "../core/types.js";
import {
  AdvancedDatumFields,
  SimpleDatumFields,
} from "../core/contract.types.js";
import {
  LOVELACE_MARGIN,
  UNAUTHORIZED_OWNER_ERROR_MSG,
} from "../core/constants.js";
// }}}
// ----------------------------------------------------------------------------

// UTILITY FUNCTIONS ----------------------------------------------------------
// {{{
/**
 * Given a UTxO and its corresponding `ReclaimConfig`, this function returns an
 * `InputUTxOAndItsOutputInfo` which carries enough information for the tx
 * builder to spend the UTxO with a valid redeemer, and potentially produce a
 * UTxO with a proper datum attached.
 *
 * @param utxo - The UTxO about to be spent
 * @param reclaimConfig - Optional advanced reclaim config
 * @param selectedWalletAddress - Selected wallet of `lucid`, i.e. signer
 * @param forSingle - Flag to distinguish between single or batch variants
 * @param network - Target network, used for getting Bech32 address of `mOwner`
 */
const utxoToOutputInfo = async (
  utxo: UTxO,
  reclaimConfig: AdvancedReclaimConfig | undefined,
  selectedWalletAddress: Address,
  forSingle: boolean,
  network: Network
): Promise<Result<InputUTxOAndItsOutputInfo>> => {
  // {{{
  return await validateUTxOAndConfig(
    utxo,
    async (
      u: UTxO,
      simpleFields: SimpleDatumFields
    ): Promise<Result<InputUTxOAndItsOutputInfo>> => {
      // {{{
      const datumBelongsToOwner =
        paymentCredentialOf(simpleFields.owner) ==
        paymentCredentialOf(selectedWalletAddress);
      if (datumBelongsToOwner) {
        return ok({
          utxo: u,
          redeemerBuilder: {
            kind: "self",
            makeRedeemer: (_ownIndex) => Data.to(new Constr(1, [])),
          },
          additionalAction: async (tx, _utxo) =>
            ok(tx.addSigner(selectedWalletAddress)),
        });
      } else {
        return {
          type: "error",
          error: new Error(UNAUTHORIZED_OWNER_ERROR_MSG),
        };
      }
      // }}}
    },
    async (
      u: UTxO,
      advancedFields: AdvancedDatumFields
    ): Promise<Result<InputUTxOAndItsOutputInfo>> => {
      // {{{
      if (reclaimConfig) {
        if (advancedFields.mOwner) {
          try {
            const mintApplicationRes = await applyRequiredMint(
              u.assets,
              reclaimConfig.additionalAction,
              advancedFields,
              advancedFields.reclaimRequiredMint,
              reclaimConfig.requiredMintConfig
            );
            if (mintApplicationRes.type == "error") return mintApplicationRes;
            const { mintAppliedInputAssets, complementedAddtionalAction } =
              mintApplicationRes.data;
            const outputAssetsRes = reduceLovelacesOfAssets(
              mintAppliedInputAssets,
              advancedFields.reclaimRouterFee
            );
            const outputDatumRes = await reclaimConfig.outputDatumMaker(
              utxo.assets,
              advancedFields
            );
            if (outputAssetsRes.type == "error") return outputAssetsRes;
            if (outputDatumRes.type == "error") return outputDatumRes;
            return ok({
              utxo: u,
              redeemerBuilder: {
                kind: "self",
                // If the UTxO is spent from a `single` smart handles, use
                // `AdvancedReclaim`, Otherwise use `ReclaimSmart` of the batch
                // spend validator.
                makeRedeemer: (ownIndex: bigint) => {
                  return Data.to(
                    forSingle
                      ? new Constr(2, [ownIndex, 0n])
                      : new Constr(1, [])
                  );
                },
              },
              outputAddress: advancedFields.mOwner,
              scriptOutput: {
                outputAssets: outputAssetsRes.data,
                outputDatum: outputDatumRes.data,
              },
              additionalAction: complementedAddtionalAction,
            });
          } catch (e) {
            return genericCatch(e);
          }
        } else {
          return {
            type: "error",
            error: new Error(
              "This advanced UTxO has no owner specified, and therefore cannot be reclaimed."
            ),
          };
        }
      } else {
        return {
          type: "error",
          error: new Error(
            "Failed to reclaim an advanced datum as no advanced reclaim logic was provided"
          ),
        };
      }
      // }}}
    },
    network
  );
  // }}}
};

/**
 * Given a partially built transaction, an `InputUTxOAndItsOutputInfo`, and a
 * corresponding `ReclaimConfig`, this function adds any required signers, valid
 * outputs, and any additional actions specified by the `advanced` case, and
 * returns the complemented transaction.
 */
const complementTx = async (
  tx: TxBuilder,
  inOutInfo: InputUTxOAndItsOutputInfo
): Promise<Result<TxBuilder>> => {
  // {{{
  let finalTx = ok(tx);
  if (inOutInfo.additionalAction) {
    try {
      finalTx = await inOutInfo.additionalAction(tx, inOutInfo.utxo);
    } catch (e) {
      return genericCatch(e);
    }
  }
  if (finalTx.type == "error") return finalTx;
  if (inOutInfo.outputAddress && inOutInfo.scriptOutput) {
    finalTx = ok(
      finalTx.data.pay.ToContract(
        inOutInfo.outputAddress,
        inOutInfo.scriptOutput.outputDatum,
        inOutInfo.scriptOutput.outputAssets
      )
    );
  }
  return finalTx;
  // }}}
};
// }}}
// ----------------------------------------------------------------------------

export const singleReclaim = async (
  lucid: LucidEvolution,
  config: SingleReclaimConfig
): Promise<Result<TxSignBuilder>> => {
  // {{{
  const va = getSingleValidatorVA(config.scriptCBOR, config.network);

  try {
    const [utxoToSpend] = await lucid.utxosByOutRef([config.requestOutRef]);

    const walletUTxOs = await lucid.wallet().getUtxos();

    const feeUTxOs = selectUTxOs(walletUTxOs, { lovelace: LOVELACE_MARGIN });

    const walletAddress = await lucid.wallet().address();

    const inUTxOAndOutInfoRes = await utxoToOutputInfo(
      utxoToSpend,
      config.advancedReclaimConfig,
      walletAddress,
      true,
      config.network
    );

    if (inUTxOAndOutInfoRes.type == "error") return inUTxOAndOutInfoRes;

    const inOutInfo = inUTxOAndOutInfoRes.data;

    const tx = lucid
      .newTx()
      .collectFrom([utxoToSpend], inOutInfo.redeemerBuilder)
      .collectFrom(feeUTxOs)
      .attach.SpendingValidator(va.validator);

    const finalTxRes = await complementTx(tx, inOutInfo);

    if (finalTxRes.type == "error") return finalTxRes;

    return ok(
      await finalTxRes.data.complete({localUPLCEval: false})
    );
  } catch (error) {
    return genericCatch(error);
  }
  // }}}
};

export const batchReclaim = async (
  lucid: LucidEvolution,
  config: BatchReclaimConfig
): Promise<Result<TxSignBuilder>> => {
  // {{{
  const network = config.network;

  const batchVAs = getBatchVAs(config.stakingScriptCBOR, network);

  if (config.requestOutRefs.length < 1)
    return { type: "error", error: new Error("No out refs provided.") };

  try {
    const utxosToSpend = await lucid.utxosByOutRef(config.requestOutRefs);

    if (!utxosToSpend)
      return {
        type: "error",
        error: new Error("None of the specified UTxOs could be fetched."),
      };

    const walletAddress = await lucid.wallet().address();

    const inUTxOAndOutInfos: InputUTxOAndItsOutputInfo[] = [];

    const badReclaimErrorMsgs: string[] = await asyncValidateItems(
      utxosToSpend,
      async (utxoToSpend: UTxO) => {
        const inUTxOAndOutInfoRes = await utxoToOutputInfo(
          utxoToSpend,
          config.advancedReclaimConfig,
          walletAddress,
          false,
          network
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

    if (badReclaimErrorMsgs.length > 0)
      return {
        type: "error",
        error: collectErrorMsgs(
          badReclaimErrorMsgs,
          "Bad reclaim(s) encountered"
        ),
      };

    const walletsUTxOs = await lucid.wallet().getUtxos();
    const feeUTxOs = selectUTxOs(walletsUTxOs, {
      lovelace: BigInt(20_000_000),
    });

    let tx = lucid
      .newTx()
      .collectFrom(utxosToSpend, Data.to(new Constr(1, [])))
      .collectFrom(feeUTxOs)
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

    // Add corresponding output UTxOs for each reclaimed UTxO. It'll fail if any
    // irreclaimable UTxOs are encountered.
    const complementTxErrors: string[] = await asyncValidateItems(
      inUTxOAndOutInfos,
      async (inOutInfo: InputUTxOAndItsOutputInfo) => {
        try {
          const txRes = await complementTx(tx, inOutInfo);
          if (txRes.type == "error") {
            return errorToString(txRes.error);
          } else {
            tx = txRes.data;
            return undefined;
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
      return ok(
        await tx.complete({localUPLCEval: false})
      );
    }
  } catch (error) {
    return genericCatch(error);
  }
  // }}}
};
