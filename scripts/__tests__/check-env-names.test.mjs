import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../check-env-names.mjs", import.meta.url));
const ENV_MD = "# x\n\n| 名稱 | 用途 |\n|---|---|\n| `DATABASE_URL` 🔒 | a |\n| `DRN_HC_BACKUP_URL` 🔒 | b |\n| `DOCKER_HOST` | c |\n| `POSTGRES_USER` | d |\n";

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "drn-envnames-"));
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, "docs/ENV.md"), ENV_MD);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}
const run = (root) => spawnSync(process.execPath, [script, "--root", root], { encoding: "utf8" });

test("all names whitelisted -> exit 0", () => {
  const root = fixture({
    ".env.example": "DATABASE_URL=\nPOSTGRES_USER=\n",
    "infra/host/drn-backup.sh": "#!/bin/bash\ncurl \"$DRN_HC_BACKUP_URL\"\nexport DOCKER_HOST=unix:///x\n",
  });
  const r = run(root);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /2 file\(s\).*0 error\(s\)/);
});

test(".env.example with an unknown name -> exit 1", () => {
  const r = run(fixture({ ".env.example": "DATABASE_URL=\nNOT_LISTED=\n" }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /NOT_LISTED is not in docs\/ENV.md/);
});

test("host script with an unknown DRN_ name -> exit 1; unknown DOCKER_ name -> exit 1", () => {
  const a = run(fixture({ "infra/host/x.sh": "echo $DRN_NOPE\n" }));
  assert.equal(a.status, 1);
  assert.match(a.stderr, /DRN_NOPE/);
  const b = run(fixture({ "infra/host/launchd/x.plist": "<string>DOCKER_NOPE</string>\n" }));
  assert.equal(b.status, 1);
  assert.match(b.stderr, /DOCKER_NOPE/);
});

test("missing docs/ENV.md names -> exit 1 (no names parsed)", () => {
  const root = mkdtempSync(join(tmpdir(), "drn-envnames-"));
  mkdirSync(join(root, "docs"));
  writeFileSync(join(root, "docs/ENV.md"), "# nothing here\n");
  const r = run(root);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no names parsed/);
});
