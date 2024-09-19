import {
  Address,
  Constr,
  Credential,
  SpendingValidator,
  Script,
  WithdrawalValidator,
  applyParamsToScript,
  validatorToAddress,
  validatorToRewardAddress,
  stakeCredentialOf,
  validatorToScriptHash,
  Network,
  CBORHex,
} from "@lucid-evolution/lucid";
import batchSpendingValidator from "../../uplc/smartHandleRouter.json";

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
 * Given a fully applied script CBOR (presumably an instance of smart-handles),
 * returns "validator and address" of the script, based on the network.
 * @param scriptCBOR - Fully applied UPLC script CBOR
 * @param network - Target network
 */
export const getSingleValidatorVA = (
  scriptCBOR: CBORHex,
  network: Network
): ValidatorAndAddress => {
  const validator: SpendingValidator = {
    type: "PlutusV2",
    script: scriptCBOR,
  };

  return {
    validator,
    address: validatorToAddress(network, validator),
  };
};

/**
 * Given a fully applied staking script CBOR (presumably an instance of
 * smart-handles), applies it to the generic batch spend from smart-handles, and
 * returns "validator and address" of both spend and staking scripts,
 * accompanied by the combined address, based on the network.
 * @param stakingScriptCBOR - Fully applied UPLC withdrawal script CBOR
 * @param network - Target network
 */
export const getBatchVAs = (
  stakingScriptCBOR: CBORHex,
  network: Network
): BatchVAs => {
  const stakingVal: WithdrawalValidator = {
    type: "PlutusV2",
    script: stakingScriptCBOR,
  };

  const rewardAddress = validatorToRewardAddress(network, stakingVal);

  const stakingCred: Credential = stakeCredentialOf(rewardAddress);

  const stakingCredData = new Constr(0, [
    new Constr(1, [validatorToScriptHash(stakingVal)]),
  ]);

  const spendingVal: SpendingValidator = {
    type: "PlutusV2",
    script: applyParamsToScript(batchSpendingValidator.cborHex, [
      stakingCredData,
    ]),
  };
  const spendingAddress = validatorToAddress(network, spendingVal);

  return {
    spendVA: {
      validator: spendingVal,
      address: spendingAddress,
    },
    stakeVA: {
      validator: stakingVal,
      address: rewardAddress,
    },
    fullAddress: validatorToAddress(network, spendingVal, stakingCred),
  };
};
