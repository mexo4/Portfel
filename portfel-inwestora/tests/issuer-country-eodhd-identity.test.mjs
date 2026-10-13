import assert from "node:assert/strict";
import test from "node:test";
import { parseEodhdCommonStockIsin } from "../src/lib/server/eodhd.ts";

const rexfordIdentity = {
  symbol: "REXR",
  provider: "yahoo",
  providerId: "REXR",
  name: "Rexford Industrial",
};

const toyotaIdentity = {
  symbol: "TM",
  provider: "finnhub",
  name: "Toyota",
};

test("EODHD listing identity recovers a common-stock ISIN but ignores listing country", () => {
  assert.equal(parseEodhdCommonStockIsin([
    {
      Code: "REXR",
      Name: "Rexford Industrial Realty Inc",
      Type: "Common Stock",
      Exchange: "US",
      Country: "USA",
      Currency: "USD",
      ISIN: "US76169C1009",
    },
  ], rexfordIdentity), "US76169C1009");

  assert.equal(parseEodhdCommonStockIsin([
    {
      Code: "TM",
      Name: "Toyota Motor Corporation ADR",
      Type: "Common Stock",
      Exchange: "US",
      Country: "USA",
      Currency: "USD",
      ISIN: "US8923313071",
    },
  ], toyotaIdentity), "US8923313071");
});

test("EODHD issuer identity rejects mismatched names, non-common equity and conflicting ISINs", () => {
  assert.equal(parseEodhdCommonStockIsin([
    {
      Code: "REXR",
      Name: "Unrelated Realty Corp",
      Type: "Common Stock",
      Exchange: "US",
      ISIN: "US76169C1009",
    },
  ], rexfordIdentity), null);

  assert.equal(parseEodhdCommonStockIsin([
    {
      Code: "REXR",
      Name: "Rexford Industrial Realty Inc",
      Type: "Preferred Stock",
      Exchange: "US",
      ISIN: "US76169C3088",
    },
  ], rexfordIdentity), null);

  assert.equal(parseEodhdCommonStockIsin([
    {
      Code: "REXR",
      Name: "Rexford Industrial Realty Inc",
      Type: "Common Stock",
      Exchange: "US",
      ISIN: "US76169C1009",
    },
    {
      Code: "REXR",
      Name: "Rexford Industrial Realty Inc",
      Type: "Common Stock",
      Exchange: "LSE",
      ISIN: "GB1234567890",
    },
  ], rexfordIdentity), null);
});

test("explicit listing suffix constrains the EODHD exchange match", () => {
  assert.equal(parseEodhdCommonStockIsin([
    {
      Code: "TM",
      Name: "Toyota Motor Corporation ADR",
      Type: "Common Stock",
      Exchange: "US",
      ISIN: "US8923313071",
    },
    {
      Code: "TM",
      Name: "Toyota Motor Corporation ADR",
      Type: "Common Stock",
      Exchange: "LSE",
      ISIN: "GB1234567890",
    },
  ], { ...toyotaIdentity, providerId: "TM.US" }), "US8923313071");

  assert.equal(parseEodhdCommonStockIsin([
    {
      Code: "TM",
      Name: "Toyota Motor Corporation ADR",
      Type: "Common Stock",
      Exchange: "US",
      ISIN: "US8923313071",
    },
  ], { ...toyotaIdentity, providerId: "TM.L" }), null);
});
