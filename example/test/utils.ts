import {
  MIN_SYMBOL_PREPROD,
  MIN_TOKEN_NAME,
} from "../src/constants.js";
import {
  mkBatchRequestConfig,
  mkSingleRequestConfig,
} from "../src/minswap-v1.js";
import {
  Emulator,
  LucidEvolution,
  EmulatorAccount,
  generateEmulatorAccount,
  Result,
  toUnit,
  singleRequest,
  batchRequest,
} from "@anastasia-labs/smart-handles-offchain";

export type LucidContext = {
  lucid: LucidEvolution;
  users: { [key: string]: EmulatorAccount };
  emulator: Emulator;
};

export const createUser = () => {
  return generateEmulatorAccount({ lovelace: BigInt(200_000_000) });
};

export const getWalletUTxOs = async (lucid: LucidEvolution) => {
  const walletAddr = await lucid.wallet().address();
  const utxos = await lucid.utxosAt(walletAddr);
  return utxos;
};

export const logWalletUTxOs = async (lucid: LucidEvolution, msg: string) => {
  const utxos = await getWalletUTxOs(lucid);
  console.log(`------------------------- ${msg} -------------------------`);
  console.log(utxos);
};

export function unsafeFromOk<T>(res: Result<T>): T {
  if (res.type == "ok") {
    return res.data;
  } else {
    throw res.error;
  }
}

export const submitAdaToMinSingleRequest = async (
  emulator: Emulator,
  lucid: LucidEvolution,
  userSeedPhrase: string
) => {
  const requestConfig = unsafeFromOk(
    await mkSingleRequestConfig(
      {
        fromAsset: "lovelace",
        quantity: BigInt(50_000_000),
        toAsset: toUnit(MIN_SYMBOL_PREPROD, MIN_TOKEN_NAME),
      },
      "Custom",
      BigInt(2_500_000)
    )
  );

  lucid.selectWallet.fromSeed(userSeedPhrase);

  // NOTE: Singular Swap Request 1
  const requestUnsigned = unsafeFromOk(
    await singleRequest(lucid, requestConfig)
  );
  // console.log(requestUnsigned.data.txComplete.to_json());
  const requestSigned = await requestUnsigned.sign.withWallet().complete();
  console.log("SINGLE REQUEST TX:", requestSigned.toCBOR());
  const requestTxHash = await requestSigned.submit();
  console.log("SINGLE REQUEST TX HASH:", requestTxHash);

  emulator.awaitBlock(100);
};

export const submitAdaToMinBatchRequests = async (
  lucid: LucidEvolution,
  emulator: Emulator,
  userSeedPhrase: string,
  lovelaces: number[]
) => {
  lucid.selectWallet.fromSeed(userSeedPhrase);
  const requestConfig = unsafeFromOk(
    await mkBatchRequestConfig(
      lovelaces.map((l) => ({
        fromAsset: "lovelace",
        quantity: BigInt(l),
        toAsset: toUnit(MIN_SYMBOL_PREPROD, MIN_TOKEN_NAME),
      })),
      "Custom",
      lovelaces.map((l) => BigInt(Math.round(l * 0.05)))
    )
  );
  const requestUnsigned = unsafeFromOk(
    await batchRequest(lucid, requestConfig)
  );
  const requestSigned = await requestUnsigned.sign.withWallet().complete();
  const requestTxHash = await requestSigned.submit();
  emulator.awaitBlock(100);
};
