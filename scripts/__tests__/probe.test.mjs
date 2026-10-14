import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";

const PROBE = fileURLToPath(new URL("../../infra/host/drn-probe.mjs", import.meta.url));
const run = (args) => spawnSync(process.execPath, [PROBE, ...args], { encoding: "utf8" });

test("a listening port is reported open with exit 1; a closed port exit 0; an unresolvable name counts as unresolved", async () => {
  const srv = net.createServer((s) => s.end());
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port;
  try {
    const open = run(["--targets", "127.0.0.1", "--ports", String(port)]);
    assert.equal(open.status, 1, open.stderr);
    const j = JSON.parse(open.stdout.trim());
    assert.equal(j.open, 1);
    assert.deepEqual(j.open_list, [`127.0.0.1:${port}`]);
  } finally {
    srv.close();
  }
  const closed = run(["--targets", "127.0.0.1", "--ports", String(port)]);
  assert.equal(closed.status, 0, closed.stderr);
  assert.equal(JSON.parse(closed.stdout.trim()).open, 0);
  const unresolved = run(["--targets", "no-such-host.invalid", "--ports", "80"]);
  assert.equal(unresolved.status, 0);
  const u = JSON.parse(unresolved.stdout.trim());
  assert.equal(u.unresolved, 1);
  assert.deepEqual(u.unresolved_list, ["no-such-host.invalid"]);
});

test("port ranges expand and bad arguments exit 2", async () => {
  const srv = net.createServer((s) => s.end());
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port;
  try {
    const r = run(["--targets", "127.0.0.1", "--ports", `${port - 1}-${port + 1}`, "--timeout", "500"]);
    const j = JSON.parse(r.stdout.trim());
    assert.equal(j.open + j.closed, 3);
    assert.ok(j.open_list.includes(`127.0.0.1:${port}`));
  } finally {
    srv.close();
  }
  assert.equal(run([]).status, 2);
  assert.equal(run(["--targets", "127.0.0.1", "--ports", "70000"]).status, 2);
});
