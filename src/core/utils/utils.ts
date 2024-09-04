import {
  Address,
  applyDoubleCborEncoding,
  Assets,
  Constr,
  Data,
  getAddressDetails,
  SpendingValidator,
  UTxO,
  addAssets,
  OutRef,
  validatorToAddress,
  keyHashToCredential,
  Network,
  LucidEvolution,
  scriptHashToCredential,
  credentialToAddress,
  DatumJson,
} from "@lucid-evolution/lucid";
import {
  AddressD,
  AdvancedDatumFields,
  SimpleDatumFields,
  Value,
  parseAdvancedDatum,
  parseSimpleDatum,
} from "../contract.types.js";
import {
  Either,
  InputUTxOAndItsOutputInfo,
  ReadableUTxO,
  Result,
} from "../types.js";
import { INSUFFICIENT_ADA_ERROR_MSG, LOVELACE_MARGIN } from "../constants.js";

export function ok<T>(x: T): Result<T> {
  return {
    type: "ok",
    data: x,
  };
}

export const utxosAtScript = async (
  lucid: LucidEvolution,
  script: string,
  network: Network,
  stakeCredentialHash?: string
) => {
  const scriptValidator: SpendingValidator = {
    type: "PlutusV2",
    script: script,
  };

  const scriptValidatorAddr = stakeCredentialHash
    ? validatorToAddress(
        network,
        scriptValidator,
        keyHashToCredential(stakeCredentialHash)
      )
    : validatorToAddress(network, scriptValidator);

  return lucid.utxosAt(scriptValidatorAddr);
};

export const parseSafeDatum = <T>(
  datum: string | null | undefined,
  datumType: T
): Either<string, T> => {
  if (datum) {
    try {
      const parsedDatum = Data.from(datum, datumType);
      return {
        type: "right",
        value: parsedDatum,
      };
    } catch (error) {
      return { type: "left", value: `invalid datum : ${error}` };
    }
  } else {
    return { type: "left", value: "missing datum" };
  }
};

export const parseUTxOsAtScript = async <T>(
  lucid: LucidEvolution,
  script: string,
  datumType: T,
  network: Network,
  stakeCredentialHash?: string
): Promise<ReadableUTxO<T>[]> => {
  try {
    const utxos = await utxosAtScript(
      lucid,
      script,
      network,
      stakeCredentialHash
    );
    return utxos.flatMap((utxo) => {
      const result = parseSafeDatum<T>(utxo.datum, datumType);
      if (result.type == "right") {
        return {
          outRef: {
            txHash: utxo.txHash,
            outputIndex: utxo.outputIndex,
          },
          datum: result.value,
          assets: utxo.assets,
        };
      } else {
        return [];
      }
    });
  } catch (e) {
    return [];
  }
};

export const toCBORHex = (rawHex: string) => {
  return applyDoubleCborEncoding(rawHex);
};

export function fromAddress(address: Address): AddressD {
  // We do not support pointer addresses!

  const { paymentCredential, stakeCredential } = getAddressDetails(address);

  if (!paymentCredential) throw new Error("Not a valid payment address.");

  return {
    paymentCredential:
      paymentCredential?.type === "Key"
        ? {
            PublicKeyCredential: [paymentCredential.hash],
          }
        : { ScriptCredential: [paymentCredential.hash] },
    stakeCredential: stakeCredential
      ? {
          Inline: [
            stakeCredential.type === "Key"
              ? {
                  PublicKeyCredential: [stakeCredential.hash],
                }
              : { ScriptCredential: [stakeCredential.hash] },
          ],
        }
      : null,
  };
}

export function toAddress(address: AddressD, network: Network): Address {
  const paymentCredential = (() => {
    if ("PublicKeyCredential" in address.paymentCredential) {
      return keyHashToCredential(
        address.paymentCredential.PublicKeyCredential[0]
      );
    } else {
      return scriptHashToCredential(
        address.paymentCredential.ScriptCredential[0]
      );
    }
  })();
  const stakeCredential = (() => {
    if (!address.stakeCredential) return undefined;
    if ("Inline" in address.stakeCredential) {
      if ("PublicKeyCredential" in address.stakeCredential.Inline[0]) {
        return keyHashToCredential(
          address.stakeCredential.Inline[0].PublicKeyCredential[0]
        );
      } else {
        return scriptHashToCredential(
          address.stakeCredential.Inline[0].ScriptCredential[0]
        );
      }
    } else {
      return undefined;
    }
  })();
  return credentialToAddress(network, paymentCredential, stakeCredential);
}

export const fromAddressToData = (address: Address): Result<Data> => {
  const addrDetails = getAddressDetails(address);

  if (!addrDetails.paymentCredential)
    return { type: "error", error: new Error("undefined paymentCredential") };

  const paymentCred =
    addrDetails.paymentCredential.type == "Key"
      ? new Constr(0, [addrDetails.paymentCredential.hash])
      : new Constr(1, [addrDetails.paymentCredential.hash]);

  if (!addrDetails.stakeCredential)
    return {
      type: "ok",
      data: new Constr(0, [paymentCred, new Constr(1, [])]),
    };

  const stakingCred = new Constr(0, [
    new Constr(0, [new Constr(0, [addrDetails.stakeCredential.hash])]),
  ]);

  return { type: "ok", data: new Constr(0, [paymentCred, stakingCred]) };
};

export const fromAddressToDatumJson = (address: Address): Result<DatumJson> => {
  const addrDetails = getAddressDetails(address);

  if (!addrDetails.paymentCredential)
    return { type: "error", error: new Error("undefined paymentCredential") };

  const paymentCred: DatumJson =
    addrDetails.paymentCredential.type == "Key"
      ? {constructor: 0, fields: [{bytes: addrDetails.paymentCredential.hash}]}
      : {constructor: 1, fields: [{bytes: addrDetails.paymentCredential.hash}]}

  if (!addrDetails.stakeCredential) {
    return {
      type: "ok",
      data: {
        constructor: 0,
        fields: [
          paymentCred,
          {constructor: 1, fields: []}
        ]
      },
    };
  }

  const stakingCred = {
    constructor: 0,
    fields: [
      {
        constructor: 0,
        fields: [{constructor: 0, fields: [{bytes: addrDetails.stakeCredential.hash}]}]
      }
    ],
  };

  return {
    type: "ok",
    data: {constructor: 0, fields: [paymentCred, stakingCred]}
  };
};

export const chunkArray = <T>(array: T[], chunkSize: number) => {
  const numberOfChunks = Math.ceil(array.length / chunkSize);

  return [...Array(numberOfChunks)].map((_value, index) => {
    return array.slice(index * chunkSize, (index + 1) * chunkSize);
  });
};

export const replacer = (_key: unknown, value: unknown) =>
  typeof value === "bigint" ? value.toString() : value;

export const divCeil = (a: bigint, b: bigint) => {
  return 1n + (a - 1n) / b;
};

export function union(a1: Assets, a2: Assets) {
  const a2Entries = Object.entries(a2);

  // initialize with clone of a1
  const result: Assets = { ...a1 };

  // add or append entries from a2
  a2Entries.forEach(([key, quantity]) => {
    if (result[key]) {
      result[key] += quantity;
    } else {
      result[key] = quantity;
    }
  });

  return result;
}

export function fromAssets(assets: Assets): Value {
  const value = new Map<string, Map<string, bigint>>();
  if (assets.lovelace) value.set("", new Map([["", assets.lovelace]]));

  const units = Object.keys(assets);
  const policies = Array.from(
    new Set(
      units
        .filter((unit) => unit !== "lovelace")
        .map((unit) => unit.slice(0, 56))
    )
  );
  policies.sort().forEach((policyId) => {
    const policyUnits = units.filter((unit) => unit.slice(0, 56) === policyId);
    const assetsMap = new Map<string, bigint>();
    policyUnits.sort().forEach((unit) => {
      assetsMap.set(unit.slice(56), assets[unit]);
    });
    value.set(policyId, assetsMap);
  });
  return value;
}

export function toAssets(value: Value): Assets {
  const result: Assets = { lovelace: value.get("")?.get("") || BigInt(0) };

  for (const [policyId, assets] of value) {
    if (policyId === "") continue;
    for (const [assetName, amount] of assets) {
      result[policyId + assetName] = amount;
    }
  }
  return result;
}

export function getLovelacesFromAssets(assets: Assets): bigint {
  const qty = assets.lovelace;
  if (qty) {
    return qty;
  } else {
    return BigInt(0);
  }
}

export function enoughLovelacesAreInAssets(
  assets: Assets,
  extraLovelaces: bigint
): boolean {
  const lovelaceCount = getLovelacesFromAssets(assets);
  return lovelaceCount >= extraLovelaces + LOVELACE_MARGIN;
}

export function reduceLovelacesOfAssets(
  assets: Assets,
  reduction: bigint,
  extraLovelacesToBeLocked?: bigint
): Result<Assets> {
  const newLovelaceCount = getLovelacesFromAssets(assets) - reduction;
  if (newLovelaceCount >= (extraLovelacesToBeLocked ?? 0n) + LOVELACE_MARGIN) {
    return {
      type: "ok",
      data: { ...assets, lovelace: newLovelaceCount },
    };
  } else {
    return {
      type: "error",
      error: new Error(INSUFFICIENT_ADA_ERROR_MSG),
    };
  }
}

/**
 * Returns a list of UTxOs whose total assets are equal to or greater than the
 * asset value provided.
 * @param utxos list of available utxos
 * @param minAssets minimum total assets required
 */
export function selectUtxos(utxos: UTxO[], minAssets: Assets): Result<UTxO[]> {
  const selectedUtxos: UTxO[] = [];
  let isSelected = false;
  const assetsRequired = new Map<string, bigint>(Object.entries(minAssets));

  for (const utxo of utxos) {
    if (utxo.scriptRef) {
      // not selecting utxos with scriptRef
      continue;
    }

    isSelected = false;

    for (const [unit, value] of assetsRequired) {
      if (Object.hasOwn(utxo.assets, unit)) {
        const utxoValue = utxo.assets[unit];

        if (utxoValue >= value) {
          assetsRequired.delete(unit);
        } else {
          assetsRequired.set(unit, value - utxoValue);
        }

        isSelected = true;
      }
    }

    if (isSelected) {
      selectedUtxos.push(utxo);
    }
    if (assetsRequired.size == 0) {
      break;
    }
  }

  if (assetsRequired.size > 0) {
    return { type: "error", error: new Error(`Insufficient funds`) };
  }

  return { type: "ok", data: selectedUtxos };
}

export function getInputUtxoIndices(
  indexInputs: UTxO[],
  remainingInputs: UTxO[]
): bigint[] {
  const allInputs = indexInputs.concat(remainingInputs);

  const sortedInputs = sortByOutRef(allInputs);
  const indicesMap = new Map<string, bigint>();

  sortedInputs.forEach((value, index) => {
    indicesMap.set(value.txHash + value.outputIndex, BigInt(index));
  });

  return indexInputs.flatMap((value) => {
    const index = indicesMap.get(value.txHash + value.outputIndex);
    if (index !== undefined) return index;
    else return [];
  });
}

export function sortByOutRef(utxos: OutRef[]): OutRef[] {
  return utxos.sort(compareOutRefs);
}

export function compareOutRefs(u0: OutRef, u1: OutRef): -1 | 0 | 1 {
  if (u0.txHash < u1.txHash) {
    return -1;
  } else if (u0.txHash > u1.txHash) {
    return 1;
  } else {
    if (u0.outputIndex < u1.outputIndex) {
      return -1;
    } else if (u0.outputIndex > u1.outputIndex) {
      return 1;
    } else {
      return 0;
    }
  }
}

export function sumUtxoAssets(utxos: UTxO[]): Assets {
  return utxos
    .map((utxo) => utxo.assets)
    .reduce((acc, assets) => addAssets(acc, assets), {});
}

/**
 * Remove the intersection of a & b asset quantities from a
 * @param a assets to be removed from
 * @param b assets to remove
 * For e.g.
 * a = {[x] : 5n, [y] : 10n}
 * b = {[x] : 3n, [y] : 15n, [z] : 4n}
 * remove(a, b) = {[x] : 2n}
 */
export function remove(a: Assets, b: Assets): Assets {
  for (const [key, value] of Object.entries(b)) {
    if (Object.hasOwn(a, key)) {
      if (a[key] < value) delete a[key];
      else if (a[key] > value) a[key] -= value;
      else delete a[key];
    }
  }

  return a;
}

/**
 * Returns the transaction hash and output index of a given UTxO formatted as
 * `${txHash}#${outputIndex}`.
 * @param u - the UTxO
 */
export function printUTxOOutRef(u: UTxO): `${string}#${string}` {
  return `${u.txHash}#${u.outputIndex.toString()}`;
}

/**
 * Applies the validator function to each element of the list to collect
 * potential failure messages.
 * @param items - Items to perform validation for each.
 * @param validator - A validation function that if failed, returns a failure
 * message, otherwise returns and `undefined`.
 * @param prependIndex - An optional flag to indicate whether error messages
 * should be prepended with the index of the failed item.
 */
export function validateItems<T>(
  items: T[],
  validator: (x: T) => undefined | string,
  prependIndex?: boolean
): string[] {
  // @ts-ignore
  return items
    .map((x, i) => {
      return validateItemsHelper(validator(x), i, prependIndex);
    })
    .filter((x) => typeof x === "string");
}

/**
 * Same as `validateItems`, but for an async validator function.
 * @param items - Items to perform validation for each.
 * @param validator - An async validation function that if failed, returns a
 * failure message, otherwise returns and `undefined`.
 * @param prependIndex - An optional flag to indicate whether error messages
 * should be prepended with the index of the failed item.
 */
export async function asyncValidateItems<T>(
  items: T[],
  validator: (x: T) => Promise<undefined | string>,
  prependIndex?: boolean
): Promise<string[]> {
  const initErrorMsgs = await Promise.all(
    items.map(async (x, i) => {
      const res = await validator(x);
      return validateItemsHelper(res, i, prependIndex);
    })
  );
  // @ts-ignore
  return initErrorMsgs.filter((x) => typeof x === "string");
}

/**
 * Helper function for implementing a consistent formatting of validation
 * functions of `validateItems` and `asyncValidateItems`.
 * @param res - The result from applying the provided validation function.
 * @param i - The item's index.
 * @param prependIndex - An optional flag to indicate whether the index should
 * be automatically prepended to the error message.
 */
function validateItemsHelper(
  res: string | undefined,
  i: number,
  prependIndex?: boolean
) {
  if (prependIndex && res) {
    return `(bad entry at index ${i}) ${res}`;
  } else {
    return res;
  }
}

export function collectErrorMsgs(msgs: string[], label: string): Error {
  return new Error(`${label}: ${msgs.join(", ")}`);
}

export function errorToString(error: any): string {
  return error.message ?? JSON.stringify(error);
}

export function genericCatch(error: any): Result<any> {
  if (error instanceof Error) return { type: "error", error: error };
  return {
    type: "error",
    error: new Error(errorToString(error)),
  };
}

/**
 * An abstract helper, primarily implemented because of types failing to cast
 * our "enum" smart handle datum.
 */
export const validateUTxOAndConfig = async (
  utxo: UTxO,
  simpleOutputBuilder: (
    u: UTxO,
    sF: SimpleDatumFields
  ) => Promise<Result<InputUTxOAndItsOutputInfo>>,
  advancedOutputBuilder: (
    u: UTxO,
    aF: AdvancedDatumFields
  ) => Promise<Result<InputUTxOAndItsOutputInfo>>,
  network: Network
): Promise<Result<InputUTxOAndItsOutputInfo>> => {
  // {{{
  if (utxo.datum) {
    const simpleFieldsRes = parseSimpleDatum(utxo.datum, network);
    if (simpleFieldsRes.type == "ok") {
      return simpleOutputBuilder(utxo, simpleFieldsRes.data);
    } else {
      const advancedFieldsRes = parseAdvancedDatum(utxo.datum, network);
      if (advancedFieldsRes.type == "ok") {
        return advancedOutputBuilder(utxo, advancedFieldsRes.data);
      } else {
        return {
          type: "error",
          error: new Error(
            "Failed to parse the UTxO's datum to either simple or advanced datum."
          ),
        };
      }
    }
  } else {
    return {
      type: "error",
      error: new Error("Specified UTxO doesn't have a datum"),
    };
  }
  // }}}
};

/**
 * Helper function for submitting a reward address registration contract. Costs
 * about 2.2 ADA.
 * @param lucid - Lucid Evolution API object, selected wallet will sign/pay
 * @param rewardAddress - Bech32 address of the staking key about to be
 *        registered
 */
export const registerRewardAddress = async (
  lucid: LucidEvolution,
  rewardAddress: string
): Promise<void> => {
  const tx = await lucid.newTx().registerStake(rewardAddress).complete();
  const signedTx = await tx.sign.withWallet().complete();
  const txHash = await signedTx.submit();
  await lucid.awaitTx(txHash);
};

/**
 * Helper function for grabbing a single UTxO from the previously selected
 * wallet, in order to be used for covering fees.
 * @param lucid - Lucid Evolution API object, note that the wallet must be
 *        already selected
 */
export const getOneUTxOFromWallet = async (lucid: LucidEvolution): Promise<Result<UTxO>> => {
  try {
    const walletsUTxOs = await lucid.wallet().getUtxos();

    if (walletsUTxOs.length < 1) {
      return {
        type: "error",
        error: new Error(
          "Selected wallet has no UTxOs to cover the fees and/or collateral"
        ),
      };
    } else {
      return ok(walletsUTxOs[0]);
    }
  } catch(e) {
    return genericCatch(e);
  }
};
