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
} from "@lucid-evolution/lucid";
import {
  collectErrorMsgs,
  errorToString,
  genericCatch,
  getBatchVAs,
  getSingleValidatorVA,
  parseSafeDatum,
  printUTxOOutRef,
  reduceLovelacesOfAssets,
  toAddress,
  validateItems,
} from "../core/utils/index.js";
import {
  Result,
  BatchReclaimConfig,
  SingleReclaimConfig,
  InputUTxOAndItsOutputInfo,
  ReclaimConfig,
} from "../core/types.js";
import { SimpleDatum, SmartHandleDatum } from "../core/contract.types.js";
// }}}
// ----------------------------------------------------------------------------

// UTILITY FUNCTIONS ----------------------------------------------------------
// {{{
const UNAUTHORIZED_OWNER_ERROR_MSG: string =
  "Signer is not authorized to claim the UTxO";

const simpleDatumBelongsToOwner = (
  d: SimpleDatum,
  ownerAddress: string
): boolean => {
  return (
    "PublicKeyCredential" in d.owner.paymentCredential &&
    d.owner.paymentCredential.PublicKeyCredential[0] ==
      paymentCredentialOf(ownerAddress).hash
  );
};

/**
 * Given a UTxO and its corresponding `ReclaimConfig`, this function returns an
 * `InputUTxOAndItsOutputInfo` which carries enough information for the tx
 * builder to spend the UTxO with a valid redeemer, and potentially produce a
 * UTxO with a proper datum attached.
 */
const utxoToOutputInfo = (
  utxo: UTxO,
  reclaimConfig: ReclaimConfig,
  selectedWalletAddress: Address,
  forSingle: boolean,
  network: Network
): Result<InputUTxOAndItsOutputInfo> => {
  // {{{
  const datum = parseSafeDatum(utxo.datum, SmartHandleDatum);
  if (datum.type == "left")
    return { type: "error", error: new Error(datum.value) };
  const smartHandleDatum = datum.value;

  const configMatchesUTxO =
    reclaimConfig.data.requestOutRef.txHash === utxo.txHash &&
    reclaimConfig.data.requestOutRef.outputIndex === utxo.outputIndex;
  if (!configMatchesUTxO) {
    return {
      type: "error",
      error: new Error(
        "Provided reclaim config does not correspond to the provided UTxO."
      ),
    };
  }
  if (reclaimConfig.kind == "simple" && "owner" in smartHandleDatum) {
    if (simpleDatumBelongsToOwner(smartHandleDatum, selectedWalletAddress)) {
      return {
        type: "ok",
        data: {
          utxo,
          redeemerBuilder: {
            kind: "self",
            makeRedeemer: (_ownIndex) => Data.to(new Constr(1, [])),
          },
        },
      };
    } else {
      return {
        type: "error",
        error: new Error(UNAUTHORIZED_OWNER_ERROR_MSG),
      };
    }
  } else if (reclaimConfig.kind == "advanced" && "mOwner" in smartHandleDatum) {
    if (smartHandleDatum.mOwner) {
      const outputAssetsRes = reduceLovelacesOfAssets(
        utxo.assets,
        smartHandleDatum.reclaimRouterFee
      );
      if (outputAssetsRes.type == "error") return outputAssetsRes;
      return {
        type: "ok",
        data: {
          utxo,
          redeemerBuilder: {
            kind: "self",
            // If the UTxO is spent from a `single` smart handles, use
            // `AdvancedReclaim`, Otherwise use `ReclaimSmart` of the batch
            // spend validator.
            makeRedeemer: (ownIndex) =>
              Data.to(
                forSingle ? new Constr(2, [ownIndex, 0n]) : new Constr(1, [])
              ),
          },
          outputAddress: toAddress(smartHandleDatum.mOwner, network),
          scriptOutput: {
            outputAssets: outputAssetsRes.data,
            outputDatum: reclaimConfig.data.outputDatum,
          },
        },
      };
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
        "Mismatch of UTxO and `ReclaimConfig`: One is `Simple` while the other is `Advanced`."
      ),
    };
  }
  // }}}
};

/**
 * Given a partially built transaction, an `InputUTxOAndItsOutputInfo`, and a
 * corresponding `ReclaimConfig`, this function adds any required signers, valid
 * outputs, and any additional actions specified by the `advanced` case, and
 * returns the complemented transaction.
 */
const complementTxWithReclaimConfigAndOutputInfo = (
  tx: TxBuilder,
  walletAddress: Address,
  inOutInfo: InputUTxOAndItsOutputInfo,
  reclaimConfig: ReclaimConfig
): TxBuilder => {
  // {{{
  if (reclaimConfig.kind == "simple") {
    return tx.addSigner(walletAddress);
  } else if (inOutInfo.outputAddress && inOutInfo.scriptOutput) {
    tx.pay.ToContract(
      inOutInfo.outputAddress,
      inOutInfo.scriptOutput.outputDatum,
      inOutInfo.scriptOutput.outputAssets
    );
    return reclaimConfig.data.additionalAction(tx, inOutInfo.utxo);
  } else {
    return tx;
  }
  // }}}
};
// }}}
// ----------------------------------------------------------------------------

export const singleReclaim = async (
  lucid: LucidEvolution,
  config: SingleReclaimConfig
): Promise<Result<TxSignBuilder>> => {
  // {{{
  const va = getSingleValidatorVA(config.scriptCBOR, lucid.config().network);

  try {
    const [utxoToSpend] = await lucid.utxosByOutRef([
      config.reclaimConfig.data.requestOutRef,
    ]);

    if (!utxoToSpend)
      return { type: "error", error: new Error("No UTxO with that TxOutRef") };

    const walletAddress = await lucid.wallet().address();

    const inUTxOAndOutInfoRes = utxoToOutputInfo(
      utxoToSpend,
      config.reclaimConfig,
      walletAddress,
      true,
      lucid.config().network
    );

    if (inUTxOAndOutInfoRes.type == "error") return inUTxOAndOutInfoRes;

    const inOutInfo = inUTxOAndOutInfoRes.data;

    const tx = lucid
      .newTx()
      .collectFrom([utxoToSpend], inOutInfo.redeemerBuilder)
      .attach.SpendingValidator(va.validator);

    const finalTx: TxBuilder = complementTxWithReclaimConfigAndOutputInfo(
      tx,
      walletAddress,
      inOutInfo,
      config.reclaimConfig
    );

    return {
      type: "ok",
      data: await finalTx.complete(),
    };
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
  const batchVAs = getBatchVAs(
    config.stakingScriptCBOR,
    lucid.config().network
  );

  if (config.reclaimConfigs.length < 1)
    return { type: "error", error: new Error("No reclaim configs provided.") };

  const network = lucid.config().network;

  try {
    const utxosToSpend = await lucid.utxosByOutRef(
      config.reclaimConfigs.map((rC: ReclaimConfig) => rC.data.requestOutRef)
    );

    if (!utxosToSpend || utxosToSpend.length !== config.reclaimConfigs.length)
      return {
        type: "error",
        error: new Error(
          "One or more of the specified UTxOs could not be found."
        ),
      };

    const walletAddress = await lucid.wallet().address();

    const utxosAndReclaimConfigs: {
      utxo: UTxO;
      reclaimConfig: ReclaimConfig;
    }[] = utxosToSpend.map((u: UTxO, i: number) => ({
      utxo: u,
      reclaimConfig: config.reclaimConfigs[i],
    }));

    const inUTxOAndOutInfos: InputUTxOAndItsOutputInfo[] = [];

    const badReclaimErrorMsgs: string[] = validateItems(
      utxosAndReclaimConfigs,
      ({ utxo: utxoToSpend, reclaimConfig }) => {
        const inUTxOAndOutInfoRes = utxoToOutputInfo(
          utxoToSpend,
          reclaimConfig,
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

    let tx = lucid
      .newTx()
      .collectFrom(utxosToSpend, Data.to(new Constr(1, [])))
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
      });

    // Add corresponding output UTxOs for each reclaimed UTxO. It'll fail if
    // any irreclaimable UTxOs are encountered.
    inUTxOAndOutInfos.map((inOutInfo: InputUTxOAndItsOutputInfo, i: number) => {
      tx = complementTxWithReclaimConfigAndOutputInfo(
        tx,
        walletAddress,
        inOutInfo,
        config.reclaimConfigs[i]
      );
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
