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
import { CborHex, Result } from "../types.js";

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
 * Given the swap address and a non-applied validator parametrized by the swap
 * address, attempts to decode the address into a `Data`, applies it, and
 * returns the acquired `Script` along with its corresponding address. "VA" is
 * short for "validator and script."
 * @param Lucid API object
 * @param The swap address in Bech32
 * @param The parametrized spending script that needs an `Address`
 */
export const getSingleValidatorVA = (
  lucid: Lucid,
  swapAddress: Address,
  spendingScript: CborHex
): Result<ValidatorAndAddress> => {
  const addressRes = fromAddressToData(swapAddress);

  if (addressRes.type == "error") return addressRes;

  const validatorScript = applyParamsToScript(spendingScript, [
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

export const getBatchVAs = (
  lucid: Lucid,
  swapAddress: Address,
  unAppliedScripts: { spending: CborHex; staking: CborHex }
): Result<BatchVAs> => {
  const addressRes = fromAddressToData(swapAddress);

  if (addressRes.type == "error") return addressRes;

  const stakingScript = applyParamsToScript(unAppliedScripts.staking, [
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
    script: applyParamsToScript(unAppliedScripts.spending, [stakingCredData]),
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
