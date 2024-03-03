import {
  Address,
  Lucid,
  SpendingValidator,
  Script,
  applyParamsToScript,
} from "@anastasia-labs/lucid-cardano-fork";
import { fromAddressToData } from "../utils/index.js";
import { CborHex, Result } from "../types.js";

type ValidatorAndAddress = {
  validator: Script;
  address: Address;
};

/**
 * Given the swap address and a non-applied validator parametrized by the swap
 * address, attempts to decode the address into a `Data`, applies it, and
 * returns the acquired `Script`.
 * @param Lucid API object
 * @param The swap address in Bech32
 * @param The parametrized spending script that needs an `Address`
 */
export const getSingleValidatorScript = (
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
