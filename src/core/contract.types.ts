import { Address, Constr, Data, Network } from "@lucid-evolution/lucid";
import { Result } from "./types.js";
import { fromAddress, fromAddressToData, genericCatch, ok, toAddress } from "./utils/utils.js";

export const OutputReferenceSchema = Data.Object({
  txHash: Data.Object({ hash: Data.Bytes({ minLength: 32, maxLength: 32 }) }),
  outputIndex: Data.Integer(),
});
export type OutputReference = Data.Static<typeof OutputReferenceSchema>;
export const OutputReference =
  OutputReferenceSchema as unknown as OutputReference;

export const CredentialSchema = Data.Enum([
  Data.Object({
    PublicKeyCredential: Data.Tuple([
      Data.Bytes({ minLength: 28, maxLength: 28 }),
    ]),
  }),
  Data.Object({
    ScriptCredential: Data.Tuple([
      Data.Bytes({ minLength: 28, maxLength: 28 }),
    ]),
  }),
]);
export type CredentialD = Data.Static<typeof CredentialSchema>;
export const CredentialD = CredentialSchema as unknown as CredentialD;

export const AddressSchema = Data.Object({
  paymentCredential: CredentialSchema,
  stakeCredential: Data.Nullable(
    Data.Enum([
      Data.Object({ Inline: Data.Tuple([CredentialSchema]) }),
      Data.Object({
        Pointer: Data.Tuple([
          Data.Object({
            slotNumber: Data.Integer(),
            transactionIndex: Data.Integer(),
            certificateIndex: Data.Integer(),
          }),
        ]),
      }),
    ])
  ),
});
export type AddressD = Data.Static<typeof AddressSchema>;
export const AddressD = AddressSchema as unknown as AddressD;

export const AssetClassSchema = Data.Object({
  symbol: Data.Bytes(),
  name: Data.Bytes(),
});
export type AssetClassD = Data.Static<typeof AssetClassSchema>;
export const AssetClassD = AssetClassSchema as unknown as AssetClassD;

export const ValueSchema = Data.Map(
  Data.Bytes(),
  Data.Map(Data.Bytes(), Data.Integer())
);
export type Value = Data.Static<typeof ValueSchema>;
export const Value = ValueSchema as unknown as Value;

export const SmartHandleDatumSchema = Data.Enum([
  Data.Object({
    Owner: AddressSchema,
  }),
  Data.Object({
    MOwner: Data.Nullable(AddressSchema),
    RouterFee: Data.Integer(),
    ReclaimRouterFee: Data.Integer(),
    ExtraInfo: Data.Any(),
  }),
]);
export type SmartHandleDatum = Data.Static<typeof SmartHandleDatumSchema>;
export const SmartHandleDatum =
  SmartHandleDatumSchema as unknown as SmartHandleDatum;

export type SimpleDatumFields = {
  owner: Address;
};

export type AdvancedDatumFields = {
  mOwner: Address | null;
  routerFee: bigint;
  reclaimRouterFee: bigint;
  extraInfo: Data;
};

export const advancedDatumFieldsToCBOR = (
  aF: AdvancedDatumFields,
): Result<string> => {
  let addr;
  if (aF.mOwner === null) {
    addr = new Constr(1, []);
  } else {
    const addrRes = fromAddressToData(aF.mOwner);
    if (addrRes.type == "ok") {
      addr = new Constr(0, [addrRes.data]);
    } else {
      return addrRes;
    }
  }
  const constr =
    new Constr(1, [
      addr,
      aF.routerFee,
      aF.reclaimRouterFee,
      aF.extraInfo
    ]);
  try {
    const cbor = Data.to(constr);
    return ok(cbor);
  } catch(e) {
    return genericCatch(e);
  }
};

export const parseSimpleDatum = (
  cbor: string,
  network: Network
): Result<SimpleDatumFields> => {
  const x0 = Data.from(cbor, Constr<Data>);
  const x1 = x0 instanceof Constr && x0.index === 0 ? x0.fields : [];
  const x2 = x1[0] instanceof Constr ? x1[0].fields : [];
  try {
    const x3: AddressD = Data.from(Data.to(x2[0]), AddressD);
    return {
      type: "ok",
      data: { owner: toAddress(x3, network) },
    };
  } catch (e) {
    return genericCatch(e);
  }
};

export const parseAdvancedDatum = (
  cbor: string,
  network: Network
): Result<AdvancedDatumFields> => {
  const x0 = Data.from(cbor, Constr<Data>);
  const x1 = x0 instanceof Constr && x0.index === 1 ? x0.fields : [];
  if ((x1[1] || x1[1] === 0n) && (x1[2] || x1[2] === 0n) && x1[3]) {
    const initMOwner =
      x1[0] instanceof Constr
        ? x1[0].index === 0
          ? x1[0].fields[0]
          : null
        : null;
    const routerFee = x1[1] ?? 0n;
    const reclaimRouterFee = x1[2] ?? 0n;
    const extraInfo = x1[3];
    try {
      return ok({
        mOwner: initMOwner
          ? toAddress(Data.from(Data.to(initMOwner), AddressD), network)
          : null,
        routerFee,
        reclaimRouterFee,
        extraInfo,
      });
    } catch (e) {
      return genericCatch(e);
    }
  } else {
    return {type: "error", error: Error("Couldn't parse advanced datum")};
  }
};
