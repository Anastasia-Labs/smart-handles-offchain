import {
  Address,
  Constr,
  Credential,
  Lucid,
  SpendingValidator,
  Script,
  WithdrawalValidator,
  applyParamsToScript,
} from "@anastasia-labs/lucid-cardano-fork";
import { fromAddressToData } from "../utils/index.js";
import { Result } from "../types.js";
import { MINSWAP_ADDRESS_MAINNET, MINSWAP_ADDRESS_PREPROD } from "../constants.js";
import singleSpendingValidator from "./smartHandleSimple.json" assert { type : "json" };
import batchSpendingValidator from "./smartHandleRouter.json" assert { type : "json" };
import stakingValidator from "./smartHandleStake.json" assert { type : "json" };

export type ValidatorAndAddress = {
  validator: Script;
  address: Address;
};

export type BatchVAs = {
  spendVA: ValidatorAndAddress;
  stakeVA: ValidatorAndAddress;
  fullAddress: Address;
};

/**
 * Returns smart handle's validator and address for Minswap. "VA" is short for
 * "validator and address."
 * @param lucid - Lucid API object
 * @param testnet? - Optional flag to use preprod
 */
export const getSingleValidatorVA = (
  lucid: Lucid,
  testnet?: boolean
): Result<ValidatorAndAddress> => {
  const swapAddress = testnet
    ? MINSWAP_ADDRESS_PREPROD
    : MINSWAP_ADDRESS_MAINNET;

  const addressRes = fromAddressToData(swapAddress);

  if (addressRes.type == "error") return addressRes;

  const validatorScript = applyParamsToScript(singleSpendingValidator.cborHex, [
    addressRes.data,
  ]);

  const validator: SpendingValidator = {
    type: "PlutusV2",
    script: validatorScript,
  };

  return {
    type: "ok",
    data: { validator, address: lucid.utils.validatorToAddress(validator) },
  };
};

/**
 * Returns validators and addresses of batch smart handles (both the spending
 * part and the staking part).
 * @param lucid - Lucid's API object
 * @param testnet? - Optional flag for preprod
 */
export const getBatchVAs = (
  lucid: Lucid,
  testnet?: boolean
): Result<BatchVAs> => {
  const swapAddress = testnet
    ? MINSWAP_ADDRESS_PREPROD
    : MINSWAP_ADDRESS_MAINNET;

  const addressRes = fromAddressToData(swapAddress);

  if (addressRes.type == "error") return addressRes;

  const stakingScript = applyParamsToScript(stakingValidator.cborHex, [
    addressRes.data,
  ]);

  const stakingVal: WithdrawalValidator = {
    type: "PlutusV2",
    script: stakingScript,
  };

  const rewardAddress = lucid.utils.validatorToRewardAddress(stakingVal);

  const stakingCred: Credential = lucid.utils.stakeCredentialOf(rewardAddress);

  const stakingCredData = new Constr(0, [
    new Constr(1, [lucid.utils.validatorToScriptHash(stakingVal)]),
  ]);

  const spendingVal: SpendingValidator = {
    type: "PlutusV2",
    script: applyParamsToScript(batchSpendingValidator.cborHex, [
      stakingCredData,
    ]),
  };
  const spendingAddress = lucid.utils.validatorToAddress(spendingVal);

  return {
    type: "ok",
    data: {
      spendVA: {
        validator: spendingVal,
        address: spendingAddress,
      },
      stakeVA: {
        validator: stakingVal,
        address: rewardAddress,
      },
      fullAddress: lucid.utils.validatorToAddress(spendingVal, stakingCred),
    },
  };
};
