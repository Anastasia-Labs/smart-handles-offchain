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
import { CborHex, LimitedNetwork, Result } from "../types.js";
import { ADA_MIN_MAINNET, ADA_MIN_PREPROD } from "../constants.js";

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
 * Given the network and a non-applied validator parametrized by the swap
 * address, attempts to decode the Minswap's address (corresponding to the
 * provided network) into a `Data`, applies it, and returns the acquired
 * `Script` along with its corresponding address. "VA" is short for "validator
 * and address."
 * @param lucid - Lucid API object
 * @param network - Currently only supports "Mainnet" and "Testnet"
 * @param unAppliedSpendingScript - The parametrized spending script that needs
 * an `Address`
 */
export const getSingleValidatorVA = (
  lucid: Lucid,
  network: LimitedNetwork,
  unAppliedSpendingScript: CborHex
): Result<ValidatorAndAddress> => {
  const swapAddress =
    network == "Mainnet" ? ADA_MIN_MAINNET.address : ADA_MIN_PREPROD.address;

  const addressRes = fromAddressToData(swapAddress);

  if (addressRes.type == "error") return addressRes;

  const validatorScript = applyParamsToScript(unAppliedSpendingScript, [
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
  network: "Mainnet" | "Testnet",
  unAppliedScripts: { spending: CborHex; staking: CborHex }
): Result<BatchVAs> => {
  const swapAddress =
    network == "Mainnet" ? ADA_MIN_MAINNET.address : ADA_MIN_PREPROD.address;

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
