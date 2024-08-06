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
} from "@lucid-evolution/lucid";
import { fromAddressToData } from "../utils/index.js";
import { Result } from "../types.js";
import {
  MINSWAP_ADDRESS_MAINNET,
  MINSWAP_ADDRESS_PREPROD,
} from "../constants.js";
import singleSpendingValidator from "../../uplc/smartHandleSimple.json";
import batchSpendingValidator from "../../uplc/smartHandleRouter.json";
import stakingValidator from "../../uplc/smartHandleStake.json";

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
 * @param network - Target network
 */
export const getSingleValidatorVA = (
  network: Network
): Result<ValidatorAndAddress> => {
  const swapAddress = network === "Mainnet"
    ? MINSWAP_ADDRESS_MAINNET
    : MINSWAP_ADDRESS_PREPROD;

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
    data: {
      validator,
      address: validatorToAddress(network, validator),
    },
  };
};

/**
 * Returns validators and addresses of batch smart handles (both the spending
 * part and the staking part).
 * @param network - Target network
 */
export const getBatchVAs = (network: Network): Result<BatchVAs> => {
  const swapAddress = network === "Mainnet"
    ? MINSWAP_ADDRESS_MAINNET
    : MINSWAP_ADDRESS_PREPROD;

  const addressRes = fromAddressToData(swapAddress);

  if (addressRes.type == "error") return addressRes;

  const stakingScript = applyParamsToScript(stakingValidator.cborHex, [
    addressRes.data,
  ]);

  const stakingVal: WithdrawalValidator = {
    type: "PlutusV2",
    script: stakingScript,
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
      fullAddress: validatorToAddress(network, spendingVal, stakingCred),
    },
  };
};
