import {
  AddressSchema,
  AdvancedDatumFields,
  AssetClassSchema,
  Data,
  ReadableUTxO,
} from "@anastasia-labs/smart-handles-offchain";

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
