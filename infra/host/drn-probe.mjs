// [P12-28] TCP reachability probe, run INSIDE a container (drn-probe.sh) or directly by the tests.
//   node drn-probe.mjs --targets host1,host2 --ports 22,80,1-1024 [--concurrency 256] [--timeout 1500]
// Resolves every target, tries a TCP connect to every port and prints one JSON line:
//   {"targets":[...],"open":N,"closed":M,"unresolved":K,"open_list":["ip:port",...]}
// Exit 1 when anything is open, 2 on bad arguments, 0 otherwise. Cannot prove: UDP, IPv6-only
// services, hosts not listed in --targets.
import net from "node:net";
import dns from "node:dns/promises";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const targets = (opt("--targets", "") || "").split(",").filter(Boolean);
const portSpec = (opt("--ports", "") || "").split(",").filter(Boolean);
const concurrency = Number(opt("--concurrency", "256"));
const timeout = Number(opt("--timeout", "1500"));
if (!targets.length || !portSpec.length) {
  console.error("usage: drn-probe.mjs --targets a,b --ports 22,80,1-1024");
  process.exit(2);
}
const ports = [];
for (const p of portSpec) {
  const m = p.match(/^(\d+)(?:-(\d+))?$/);
  if (!m) { console.error(`bad port spec ${p}`); process.exit(2); }
  const a = Number(m[1]), b = Number(m[2] ?? m[1]);
  if (a < 1 || b > 65535 || a > b) { console.error(`bad port range ${p}`); process.exit(2); }
  for (let x = a; x <= b; x++) ports.push(x);
}

const resolved = [];
const unresolved = [];
for (const t of targets) {
  if (net.isIP(t)) { resolved.push({ target: t, ip: t }); continue; }
  try {
    const { address } = await dns.lookup(t, { family: 4 });
    resolved.push({ target: t, ip: address });
  } catch {
    unresolved.push(t);
  }
}

const connect = (ip, port) =>
  new Promise((resolve) => {
    const s = net.connect({ host: ip, port, timeout });
    const done = (r) => { s.destroy(); resolve(r); };
    s.once("connect", () => done("open"));
    s.once("timeout", () => done("closed"));
    s.once("error", () => done("closed"));
  });

const jobs = [];
for (const r of resolved) for (const port of ports) jobs.push({ r, port });
let open = 0, closed = 0;
const openList = [];
let next = 0;
async function worker() {
  while (next < jobs.length) {
    const j = jobs[next++];
    const res = await connect(j.r.ip, j.port);
    if (res === "open") { open++; openList.push(`${j.r.ip}:${j.port}`); } else closed++;
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length || 1) }, worker));
console.log(JSON.stringify({ targets: resolved.map((r) => `${r.target}=${r.ip}`), open, closed, unresolved: unresolved.length, unresolved_list: unresolved, open_list: openList.sort() }));
process.exit(open > 0 ? 1 : 0);
