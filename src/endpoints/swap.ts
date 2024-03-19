import {
  Assets,
  Constr,
  Data,
  OutputData,
  Lucid,
  SpendingValidator,
  TxComplete,
  paymentCredentialOf,
  OutRef,
  Address,
  UTxO,
} from "@anastasia-labs/lucid-cardano-fork";
import {
  LOVELACE_MARGIN,
  MIN_SYMBOL,
  MIN_TOKEN_NAME,
  ROUTER_FEE,
} from "../core/constants.js";
import {
  AdaMinOutputDatum,
  OrderType,
  SmartHandleDatum,
} from "../core/contract.types.js";
import { BatchSwapConfig, Result, SingleSwapConfig } from "../core/types.js";
import {
  BatchVAs,
  asyncValidateItems,
  collectErrorMsgs,
  compareOutRefs,
  genericCatch,
  getBatchVAs,
  getInputUtxoIndices,
  getSingleValidatorVA,
  parseSafeDatum,
  selectUtxos,
} from "../core/utils/index.js";

export const singleSwap = async (
  lucid: Lucid,
  config: SingleSwapConfig
): Promise<Result<TxComplete>> => {
  const vaRes = getSingleValidatorVA(
    lucid,
    config.swapAddress,
    config.spendingScript
  );

  if (vaRes.type == "error") return vaRes;

  try {
    const validator: SpendingValidator = vaRes.data.validator;

    const outputInfoRes = await getOutputInfo(
      lucid,
      vaRes.data.address,
      config.requestOutRef,
      config.minReceive
    );

    if (outputInfoRes.type == "error") return outputInfoRes;

    const [utxoToSpend, outputDatumHash, outputAssets] = outputInfoRes.data;

    const ownHash = paymentCredentialOf(await lucid.wallet.address()).hash;

    const redeemerIndicesAndFeeUTxOsRes = await getRedeemerIndicesAndFeeUTxOs(
      lucid,
      [utxoToSpend]
    );

    if (redeemerIndicesAndFeeUTxOsRes.type == "error")
      return redeemerIndicesAndFeeUTxOsRes;

    const [inputIndices, feeUTxOs] = redeemerIndicesAndFeeUTxOsRes.data;

    if (inputIndices.length !== 1)
      return { type: "error", error: new Error("Something went wrong") };

    const PSwapRedeemer = Data.to(new Constr(0, [inputIndices[0], 0n]));

    // Implicit assumption that who creates the transaction is the routing
    // agent. Therefore the change output from the spent UTxO (which is getting
    // reproduced at the swap address with `ROUTER_FEE` less Lovelaces), is
    // going to be collected by the routing agent.
    const tx = await lucid
      .newTx()
      .collectFrom([utxoToSpend], PSwapRedeemer)
      .collectFrom(feeUTxOs)
      .addSignerKey(ownHash) // For collateral UTxO
      .attachSpendingValidator(validator)
      .payToContract(config.swapAddress, outputDatumHash, outputAssets)
      .complete();
    return { type: "ok", data: tx };
  } catch (error) {
    return genericCatch(error);
  }
};

export const batchSwap = async (
  lucid: Lucid,
  config: BatchSwapConfig
): Promise<Result<TxComplete>> => {
  const batchVAsRes = getBatchVAs(lucid, config.swapAddress, config.scripts);

  if (batchVAsRes.type == "error") return batchVAsRes;

  const batchVAs: BatchVAs = batchVAsRes.data;

  try {
    const ownHash = paymentCredentialOf(await lucid.wallet.address()).hash;

    const swapUTxOs: UTxO[] = [];

    const initTx = lucid
      .newTx()
      .addSignerKey(ownHash) // For collateral UTxO
      .attachSpendingValidator(batchVAs.spendVA.validator)
      .attachWithdrawalValidator(batchVAs.stakeVA.validator);

    // Prior sorting needed as the traversal also adds corresponding outputs.
    const sortedSwaps = config.swapInfos.sort((a, b) =>
      compareOutRefs(a.requestOutRef, b.requestOutRef)
    );

    // There are 3 things happening as we traverse `sortedSwaps`:
    // - Swap's UTxO gets validated to make sure its coming from the script
    //   address and has a proper datum attached to it. In case of failure, the
    //   issue gets recorded into the list as a string and the other steps are
    //   skipped.
    // - The UTxO gets incorporated into the initiated transaction for spending.
    // - The resolved UTxO gets pushed into `swapUTxOs` so that we can find
    //   appropriated indices for the withdrawal redeemer.
    const swapErrorMsgs = await asyncValidateItems(
      sortedSwaps,
      async ({ requestOutRef, minReceive }) => {
        const outputInfoRes = await getOutputInfo(
          lucid,
          batchVAs.spendVA.address,
          requestOutRef,
          minReceive
        );
        if (outputInfoRes.type == "error") {
          return `${requestOutRef}: ${JSON.stringify(outputInfoRes.error)}`;
        } else {
          const [utxoToSpend, outputDatumHash, outputAssets] =
            outputInfoRes.data;
          swapUTxOs.push(utxoToSpend);
          initTx.payToContract(
            config.swapAddress,
            outputDatumHash,
            outputAssets
          );
          return undefined;
        }
      }
    );

    if (swapErrorMsgs.length > 0)
      return {
        type: "error",
        error: collectErrorMsgs(swapErrorMsgs, "Bad swaps encountered"),
      };

    const redeemerIndicesAndFeeUTxOsRes = await getRedeemerIndicesAndFeeUTxOs(
      lucid,
      swapUTxOs
    );

    if (redeemerIndicesAndFeeUTxOsRes.type == "error")
      return redeemerIndicesAndFeeUTxOsRes;

    const [inputIndices, feeUTxOs] = redeemerIndicesAndFeeUTxOsRes.data;

    const PSwapRedeemerSpend = Data.to(new Constr(0, []));

    // const sampleRedeemer = Data.to(
    //   new Constr(
    //     0,
    //     [[0n, 1n, 2n], [0n, 1n, 2n]]
    //   )
    // );
    // console.log("SAMPLE REDEEMER", sampleRedeemer);

    const PSwapRedeemerWdrl = Data.to(
      new Constr(0, [
        inputIndices,
        Array.from({ length: inputIndices.length }, (_, index) => index).map(
          BigInt
        ),
      ])
    );
    console.log("REWARD ADDRESS A", batchVAs.stakeVA.address);
    const tx = await initTx
      .collectFrom(swapUTxOs, PSwapRedeemerSpend)
      .collectFrom(feeUTxOs)
      .withdraw(batchVAs.stakeVA.address, 0n, PSwapRedeemerWdrl)
      .complete();
    return { type: "ok", data: tx };
  } catch (error) {
    return genericCatch(error);
  }
};

const getOutputInfo = async (
  lucid: Lucid,
  validatorAddress: Address,
  requestOutRef: OutRef,
  minReceive: bigint
): Promise<Result<[UTxO, OutputData, Assets]>> => {
  try {
    const [utxoToSpend] = await lucid.utxosByOutRef([requestOutRef]);

    if (!utxoToSpend)
      return { type: "error", error: new Error("No UTxO with that TxOutRef") };

    if (!utxoToSpend.datum)
      return { type: "error", error: new Error("Missing Datum") };

    if (utxoToSpend.address !== validatorAddress)
      return {
        type: "error",
        error: new Error("UTxO is not coming from the script address"),
      };

    const datum = parseSafeDatum(lucid, utxoToSpend.datum, SmartHandleDatum);

    if (datum.type == "left")
      return { type: "error", error: new Error(datum.value) };

    const ownerAddress = datum.value.owner;

    const outputOrderType: OrderType = {
      desiredAsset: {
        symbol: MIN_SYMBOL,
        name: MIN_TOKEN_NAME,
      },
      minReceive,
    };

    // const minSwapAddress: AddressD = {
    //   paymentCredential: {
    //     ScriptCredential: ["a65ca58a4e9c755fa830173d2a5caed458ac0c73f97db7faae2e7e3b"]
    //   },
    //   stakeCredential: {
    //     Inline: [
    //       { PublicKeyCredential: ["52563c5410bff6a0d43ccebb7c37e1f69f5eb260552521adff33b9c2"]
    //       }
    //     ]
    //   }
    // };

    // const sampleDatum: AdaMinOutputDatum = {
    //   sender: minSwapAddress,
    //   receiver: minSwapAddress,
    //   receiverDatumHash: null,
    //   step: outputOrderType,
    //   batcherFee: 2000000n,
    //   outputAda: 2000000n,
    // };

    // const sampleDatumCBOR = Data.to<AdaMinOutputDatum>(
    //   sampleDatum,
    //   AdaMinOutputDatum
    // );

    // console.log("SAMPLE DATUM", sampleDatumCBOR);

    const outputDatum: AdaMinOutputDatum = {
      sender: ownerAddress,
      receiver: ownerAddress,
      receiverDatumHash: null,
      step: outputOrderType,
      batcherFee: 2000000n,
      outputAda: 2000000n,
    };

    const outputDatumData = Data.to<AdaMinOutputDatum>(
      outputDatum,
      AdaMinOutputDatum
    );

    // Hashed since `SingleValidator` expects as such for the swap address
    // output UTxO.
    const outputDatumHash: OutputData = {
      inline: outputDatumData,
    };

    const inputLovelaces = utxoToSpend.assets["lovelace"];

    if (inputLovelaces < ROUTER_FEE + LOVELACE_MARGIN)
      return {
        type: "error",
        error: new Error("Not enough Lovelaces are present in the UTxO"),
      };

    const outputAssets = {
      ...utxoToSpend.assets,
      lovelace: inputLovelaces - ROUTER_FEE,
    };
    return {
      type: "ok",
      data: [utxoToSpend, outputDatumHash, outputAssets],
    };
  } catch (error) {
    return genericCatch(error);
  }
};

const getRedeemerIndicesAndFeeUTxOs = async (
  lucid: Lucid,
  utxosToSpend: UTxO[]
): Promise<Result<[bigint[], UTxO[]]>> => {
  try {
    const walletUTxOs = await lucid.wallet.getUtxos();

    // Using `LOVELACE_MARGIN` as the minimum required Lovelaces so that the
    // collected routing fee minus the transaction fee doesn't go below the min
    // required Lovelaces for a UTxO. TODO?
    const requiredAssets: Assets = { lovelace: LOVELACE_MARGIN };

    const selectedUtxos = selectUtxos(walletUTxOs, requiredAssets);

    if (selectedUtxos.type == "error") return selectedUtxos;

    const inputIndices = getInputUtxoIndices(utxosToSpend, selectedUtxos.data);
    return {
      type: "ok",
      data: [inputIndices, selectedUtxos.data],
    };
  } catch (error) {
    return genericCatch(error);
  }
};
