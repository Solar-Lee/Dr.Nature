import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const catalog = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../content/products/catalog.json", import.meta.url)), "utf8"),
);
const SKU_RE = /^DN-[A-Z]{2}-\d{2}-\d{3}[CTSG](-(X[2-9]|X[1-9]\d|TRY))?$/;
const HANDLE_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function ean13Valid(code) {
  if (!/^\d{13}$/.test(code)) return false;
  const digits = [...code].map(Number);
  const sum = digits.slice(0, 12).reduce((s, d, i) => s + d * (i % 2 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === digits[12];
}

test("catalog has products", () => {
  assert.ok(Array.isArray(catalog.products) && catalog.products.length > 0);
});

test("every SKU follows docs/product/sku-coding.md", () => {
  for (const p of catalog.products) assert.match(p.sku, SKU_RE, p.sku);
});

test("SKU regex rejects malformed codes", () => {
  for (const bad of ["DN-PB-1-060C", "dn-pb-01-060c", "DN-PB-01-060X", "DN-PB-01-060C-X1", "DN-PB-01-060C-TRY2"]) {
    assert.doesNotMatch(bad, SKU_RE, bad);
  }
});

test("SKUs and handles are unique", () => {
  const skus = catalog.products.map((p) => p.sku);
  const handles = catalog.products.map((p) => p.handle);
  assert.equal(new Set(skus).size, skus.length);
  assert.equal(new Set(handles).size, handles.length);
});

test("handles are URL-safe slugs", () => {
  for (const p of catalog.products) assert.match(p.handle, HANDLE_RE, p.handle);
});

test("prices are positive whole TWD (ECPay needs integer amounts)", () => {
  assert.equal(catalog.currency, "twd");
  for (const p of catalog.products) {
    assert.ok(Number.isInteger(p.price) && p.price > 0, `${p.sku} price ${p.price}`);
  }
});

test("series codes are registered", () => {
  for (const p of catalog.products) {
    assert.ok(catalog.series[p.series], `${p.sku} uses unregistered series ${p.series}`);
    assert.equal(p.sku.split("-")[1], p.series);
  }
});

test("EAN-13, when present, has a valid check digit", () => {
  assert.equal(ean13Valid("4006381333931"), true);
  assert.equal(ean13Valid("4006381333932"), false);
  for (const p of catalog.products) {
    if (p.ean13 !== null) assert.ok(ean13Valid(p.ean13), `${p.sku} ean13 ${p.ean13}`);
  }
});
