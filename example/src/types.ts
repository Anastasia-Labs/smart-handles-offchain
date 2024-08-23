import { Data } from "@lucid-evolution/lucid";
import {
  AdvancedDatumFields,
  ReadableUTxO,
} from "@anastasia-labs/smart-handles-offchain";

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

export const MinswapRequestInfoSchema = Data.Object({
  desiredAssetSymbol: Data.Bytes(),
  desiredAssetTokenName: Data.Bytes(),
  receiverDatumHash: Data.Nullable(Data.Bytes()),
  minimumReceive: Data.Integer(),
});
export type MinswapRequestInfo = Data.Static<typeof MinswapRequestInfoSchema>;
export const MinswapRequestInfo =
  MinswapRequestInfoSchema as unknown as MinswapRequestInfo;

export const OrderTypeSchema = Data.Object({
  desiredAsset: AssetClassSchema,
  minReceive: Data.Integer(),
});
export type OrderType = Data.Static<typeof OrderTypeSchema>;
export const OrderType = OrderTypeSchema as unknown as OrderType;

export const OrderDatumSchema = Data.Object({
  sender: AddressSchema,
  receiver: AddressSchema,
  receiverDatumHash: Data.Nullable(Data.Bytes()),
  step: OrderTypeSchema,
  batcherFee: Data.Integer(),
  depositADA: Data.Integer(),
});
export type OrderDatum = Data.Static<typeof OrderDatumSchema>;
export const OrderDatum = OrderDatumSchema as unknown as OrderDatum;

export type MinswapV1RequestUTxO = ReadableUTxO<AdvancedDatumFields>;
