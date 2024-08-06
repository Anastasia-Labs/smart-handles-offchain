import {
  Emulator,
  LucidEvolution,
  EmulatorAccount,
  generateEmulatorAccount,
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
