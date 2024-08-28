import {Constr, Data} from "@lucid-evolution/lucid";
import {AdvancedDatumFields, advancedDatumFieldsToCBOR, parseAdvancedDatum} from "../src/core/contract.types.js";
import { expect, test } from "vitest";

test("CBOR Encoding/Decoding of `AdvancedDatumFields` Values", () => {
  const info0 = new Constr(0, [
    "29d222ce763455e3d7a09a665ce554f00ac89d2e99a1a83d267170c6",
    "4d494e",
    new Constr(1, []),
    BigInt(40_000_000)
  ]);
  const info1 = new Constr(1, []);
  const info2 = "29d222ce763455e3d7a09a665ce554f00ac89d2e99a1a83d267170c6";
  const aF0: AdvancedDatumFields = {
    mOwner: "addr1zxn9efv2f6w82hagxqtn62ju4m293tqvw0uhmdl64ch8uw6j2c79gy9l76sdg0xwhd7r0c0kna0tycz4y5s6mlenh8pq6s3z70",
    routerFee: BigInt(1_000_000),
    reclaimRouterFee: BigInt(500_000),
    extraInfo: info0,
  };
  const aF1: AdvancedDatumFields = {
    mOwner: null,
    routerFee: BigInt(2_000_000),
    reclaimRouterFee: BigInt(0),
    extraInfo: info1,
  };
  const aF2: AdvancedDatumFields = {
    mOwner: "addr_test1zzn9efv2f6w82hagxqtn62ju4m293tqvw0uhmdl64ch8uwurajt8r8wqtygrfduwgukk73m5gcnplmztc5tl5ngy0upq932hcy",
    routerFee: BigInt(0),
    reclaimRouterFee: BigInt(0),
    extraInfo: info2,
  };
  const cborRes0 = advancedDatumFieldsToCBOR(aF0);
  const cborRes1 = advancedDatumFieldsToCBOR(aF1);
  const cborRes2 = advancedDatumFieldsToCBOR(aF2);
  expect(cborRes0.type).toBe("ok");
  expect(cborRes1.type).toBe("ok");
  expect(cborRes2.type).toBe("ok");
  if (cborRes0.type == "error") throw cborRes0.error;
  if (cborRes1.type == "error") throw cborRes1.error;
  if (cborRes2.type == "error") throw cborRes2.error;
  const aF0ParseRes = parseAdvancedDatum(cborRes0.data!, "Mainnet");
  const aF1ParseRes = parseAdvancedDatum(cborRes1.data!, "Preprod");
  const aF2ParseRes = parseAdvancedDatum(cborRes2.data!, "Preprod");
  expect(aF0ParseRes.type).toBe("ok");
  expect(aF1ParseRes.type).toBe("ok");
  expect(aF2ParseRes.type).toBe("ok");
  if (aF0ParseRes.type == "error") throw aF0ParseRes.error;
  if (aF1ParseRes.type == "error") throw aF1ParseRes.error;
  if (aF2ParseRes.type == "error") throw aF2ParseRes.error;
  expect(aF0ParseRes.data.mOwner).toBe(aF0.mOwner);
  expect(aF0ParseRes.data.routerFee).toBe(aF0.routerFee);
  expect(aF0ParseRes.data.reclaimRouterFee).toBe(aF0.reclaimRouterFee);
  expect(Data.to(aF0ParseRes.data.extraInfo)).toBe(Data.to(aF0.extraInfo))
  expect(aF1ParseRes.data.mOwner).toBe(aF1.mOwner);
  expect(aF1ParseRes.data.routerFee).toBe(aF1.routerFee);
  expect(aF1ParseRes.data.reclaimRouterFee).toBe(aF1.reclaimRouterFee);
  expect(Data.to(aF1ParseRes.data.extraInfo)).toBe(Data.to(aF1.extraInfo))
  expect(aF2ParseRes.data.mOwner).toBe(aF2.mOwner);
  expect(aF2ParseRes.data.routerFee).toBe(aF2.routerFee);
  expect(aF2ParseRes.data.reclaimRouterFee).toBe(aF2.reclaimRouterFee);
  expect(Data.to(aF2ParseRes.data.extraInfo)).toBe(Data.to(aF2.extraInfo))
});
