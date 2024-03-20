import { Address, PolicyId } from "@anastasia-labs/lucid-cardano-fork";
import { AssetClass } from "./types.js";

/**
 * Amount of Lovelaces required as a convenient alternative to finding the
 * minimum required Lovelaces.
 */
export const LOVELACE_MARGIN = 2_000_000n;

/**
 * Hard-coded router fee in Lovelaces. Note that this must match the value from
 * the on-chain validator.
 */
export const ROUTER_FEE = 1_000_000n;

/**
 * Minswap batcher fee in Lovelaces..
 */
export const MINSWAP_BATCHER_FEE = 2_000_000n;

/**
 * Minimum Lovelaces to be sent to users along with their purchased tokens.
 */
export const MINSWAP_DEPOSIT = 2_000_000n;

/**
 * Minswap address on mainnet.
 */
const MINSWAP_ADDRESS_MAINNET =
  "addr1zxn9efv2f6w82hagxqtn62ju4m293tqvw0uhmdl64ch8uw6j2c79gy9l76sdg0xwhd7r0c0kna0tycz4y5s6mlenh8pq6s3z70";

/**
 * Minswap address on preprod.
 */
const MINSWAP_ADDRESS_PREPROD =
  "addr_test1zzn9efv2f6w82hagxqtn62ju4m293tqvw0uhmdl64ch8uwurajt8r8wqtygrfduwgukk73m5gcnplmztc5tl5ngy0upq932hcy";

/**
 * Policy ID of $MIN token on mainnet.
 */
const MIN_SYMBOL_MAINNET =
  "29d222ce763455e3d7a09a665ce554f00ac89d2e99a1a83d267170c6";

/**
 * Policy ID of $MIN token on preprod.
 */
const MIN_SYMBOL_PREPROD =
  "e16c2dc8ae937e8d3790c7fd7168d7b994621ba14ca11415f39fed72";

/**
 * Token name of $MIN in hex.
 */
const MIN_TOKEN_NAME = "4d494e";

/**
 * Policy ID of MIN-ADA LP token on both preprod and mainnet.
 */
const ADA_MIN_LP_SYMBOL =
  "e4214b7cce62ac6fbba385d164df48e157eae5863521b4b67ca71d86";

/**
 * ID of ADA-MIN Pool on Testnet Preprod
 */
const ADA_MIN_LP_TOKEN_NAME_PREPROD =
  "3bb0079303c57812462dec9de8fb867cef8fd3768de7f12c77f6f0dd80381d0d";

/**
 * ID of ADA-MIN Pool on mainnet.
 */
const ADA_MIN_LP_TOKEN_NAME_MAINNET =
  "6aa2153e1ae896a95539c9d62f76cedcdabdcdf144e564b8955f609d660cf6a2";

export type AdaMinConstants = {
  address: Address;
  minAsset: AssetClass;
  poolSymbol: PolicyId;
  poolId: string;
};

/**
 * Collection of values related to Minswap on preprod.
 */
export const ADA_MIN_PREPROD: AdaMinConstants = {
  address: MINSWAP_ADDRESS_PREPROD,
  minAsset: {
    policyId: MIN_SYMBOL_PREPROD,
    tokenName: MIN_TOKEN_NAME,
  },
  poolSymbol: ADA_MIN_LP_SYMBOL,
  poolId: ADA_MIN_LP_TOKEN_NAME_PREPROD,
};

/**
 * Collection of values related to Minswap on mainnet.
 */
export const ADA_MIN_MAINNET = {
  address: MINSWAP_ADDRESS_MAINNET,
  minAsset: {
    policyId: MIN_SYMBOL_MAINNET,
    tokenName: MIN_TOKEN_NAME,
  },
  poolSymbol: ADA_MIN_LP_SYMBOL,
  poolId: ADA_MIN_LP_TOKEN_NAME_MAINNET,
};
