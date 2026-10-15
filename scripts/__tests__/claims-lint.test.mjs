import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DEFAULT_TARGETS, loadRules, lintText } from "../claims-lint.mjs";

const rules = loadRules();
const SCRIPT = fileURLToPath(new URL("../claims-lint.mjs", import.meta.url));

test("flags medical-efficacy wording", () => {
  const hits = lintText("每天兩顆，改善便秘", rules);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].term, "便秘");
  assert.equal(hits[0].level, "error");
});

test("flags every occurrence, not just the first", () => {
  const hits = lintText("過敏 與 過敏", rules).filter((h) => h.term === "過敏");
  assert.equal(hits.length, 2);
});

test("reports correct line and column", () => {
  const hits = lintText("第一行\n顧眼睛的好選擇", rules);
  assert.deepEqual([hits[0].line, hits[0].column, hits[0].term], [2, 1, "顧眼"]);
});

test("official permitted phrases pass", () => {
  for (const ok of ["幫助消化", "使排便順暢", "調整體質", "改變細菌叢生態", "營養補給"]) {
    assert.deepEqual(lintText(ok, rules), [], ok);
  }
});

test("allow-listed disclaimer passes only when quoted exactly", () => {
  assert.deepEqual(lintText("本產品為一般食品，非藥品，不具醫療效能。", rules), []);
  assert.deepEqual(lintText("本產品非健康食品，未經健康食品查驗登記。", rules), []);
  // Same words outside the exact sentence must still be caught.
  assert.ok(lintText("榮獲健康食品認證", rules).some((h) => h.term === "健康食品"));
});

test("warn-level rules are reported but not errors", () => {
  const hits = lintText("晶亮益生菌", rules);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].level, "warn");
});

test("CLI exits non-zero on a banned term and zero on clean text", () => {
  const dir = mkdtempSync(join(tmpdir(), "claims-"));
  const bad = join(dir, "bad.md");
  const good = join(dir, "good.md");
  writeFileSync(bad, "增強抵抗力");
  writeFileSync(good, "幫助維持消化道機能");
  assert.equal(spawnSync(process.execPath, [SCRIPT, bad]).status, 1);
  assert.equal(spawnSync(process.execPath, [SCRIPT, good]).status, 0);
});

test("every default target exists, so the no-argument run never lints nothing (CC-07)", () => {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const missing = DEFAULT_TARGETS.filter((t) => !existsSync(join(root, t)));
  assert.deepEqual(missing, []);
  assert.ok(DEFAULT_TARGETS.includes("apps/storefront/lib") && DEFAULT_TARGETS.includes("apps/storefront/app"));
});
