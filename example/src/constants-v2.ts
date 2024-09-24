/**
 * Router fee for simple routes (must remain in sync with hard coded on-chain
 * value.
 */
export const ROUTER_FEE = 1_000_000n;

export const SLIPPAGE_TOLERANCE = 10;

/**
 * Minswap batcher fee in Lovelaces.
 */
export const MINSWAP_BATCHER_FEE = 2_000_000n;

/**
 * Minimum Lovelaces to be sent to users along with their purchased tokens.
 */
export const MINSWAP_DEPOSIT = 2_000_000n;

/**
 * Minswap address on preprod.
 */
export const MINSWAP_ADDRESS_PREPROD =
  "addr_test1wrdf2f2x8pq3wwk3yv936ksmt59rz94mm66yzge8zj9pk7s0kjph3";

/**
 * Minswap address on mainnet.
 */
export const MINSWAP_ADDRESS_MAINNET =
  "addr1w8p79rpkcdz8x9d6tft0x0dx5mwuzac2sa4gm8cvkw5hcnqst2ctf";

/**
 * Policy ID of $MIN token on preprod.
 */
export const MIN_SYMBOL_PREPROD =
  "e16c2dc8ae937e8d3790c7fd7168d7b994621ba14ca11415f39fed72";

/**
 * Policy ID of $MIN token on mainnet.
 */
export const MIN_SYMBOL_MAINNET =
  "29d222ce763455e3d7a09a665ce554f00ac89d2e99a1a83d267170c6";

/**
 * Token name of $MIN in hex.
 */
export const MIN_TOKEN_NAME = "4d494e";

/**
 * Policy ID of MIN-ADA LP token on preprod.
 */
export const ADA_MIN_LP_SYMBOL_PREPROD =
  "d6aae2059baee188f74917493cf7637e679cd219bdfbbf4dcbeb1d0b";

/**
 * Policy ID of MIN-ADA LP token on mainnet.
 */
export const ADA_MIN_LP_SYMBOL_MAINNET =
  "f5808c2c990d86da54bfc97d89cee6efa20cd8461616359478d96b4c";

/**
 * ID of ADA-MIN Pool on Testnet Preprod
 */
export const ADA_MIN_LP_TOKEN_NAME_PREPROD =
  "6c3ea488e6ff940bb6fb1b18fd605b5931d9fefde6440117015ba484cf321200";

/**
 * ID of ADA-MIN Pool on mainnet.
 */
export const ADA_MIN_LP_TOKEN_NAME_MAINNET =
  "82e2b1fd27a7712a1a9cf750dfbea1a5778611b20e06dd6a611df7a643f8cb75";

