import {MIN_SYMBOL_PREPROD, MIN_TOKEN_NAME} from "../example/src/constants.js";
import {mkSingleRequestConfig} from "../example/src/minswap-v1.js";
import {
  Emulator,
  LucidEvolution,
  EmulatorAccount,
  generateEmulatorAccount,
  Result,
  toUnit,
  singleRequest,
} from "../src/index.js";

export type LucidContext = {
  lucid: LucidEvolution;
  users: {[key: string]: EmulatorAccount};
  emulator: Emulator;
};

export const createUser = () => {
  return generateEmulatorAccount({ lovelace: BigInt(100_000_000) });
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

export const submitAdaToMinRequest = async (
  emulator: Emulator,
  lucid: LucidEvolution,
  userSeedPhrase: string,
) => {
  const requestConfig = unsafeFromOk(await mkSingleRequestConfig(
    {
      fromAsset: "lovelace",
      quantity: BigInt(50_000_000),
      toAsset: toUnit(MIN_SYMBOL_PREPROD, MIN_TOKEN_NAME),
    },
    "Custom"
  ));

  lucid.selectWallet.fromSeed(userSeedPhrase);

  // NOTE: Singular Swap Request 1
  const requestUnsigned = unsafeFromOk(await singleRequest(lucid, requestConfig));
  // console.log(requestUnsigned.data.txComplete.to_json());
  const requestSigned = await requestUnsigned.sign
    .withWallet()
    .complete();
  console.log("SINGLE REQUEST TX:", requestSigned.toCBOR());
  const requestTxHash = await requestSigned.submit();
  console.log("SINGLE REQUEST TX HASH:", requestTxHash);

  emulator.awaitBlock(100);
};
