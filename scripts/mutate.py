# Break-it (mutation) runner for CLAUDE.md §4: apply one mutation at a time, run the targeted
# jest test, and report whether the suite turned red; the file is restored after every run.
#
# Run it in a SEPARATE git worktree (never in the checkout you are editing, never while the
# hot-reloading dev server runs):
#   git worktree add ../drn-mut main && (cd ../drn-mut && pnpm install --frozen-lockfile)
#   python3 scripts/mutate.py ../drn-mut/apps/backend mutations.json
# mutations.json: [{"name", "path" (relative to apps/backend), "old" (must occur exactly once),
#                   "new", "spec", "t" (jest -t pattern, a REGEX: avoid ( ) + ? .),
#                   "type" (optional, default integration:http; "unit" for unit specs)}]
# Verdicts: RED (caught) | GREEN (NOT caught: usually a missing assertion, add a test) |
#           INVALID RUN (no test ran, or the run crashed: fix the -t pattern and rerun).
# Stop it with SIGINT so the finally block restores the mutated file.
import json, subprocess, sys

wd, mfile = sys.argv[1], sys.argv[2]
M = json.load(open(mfile, encoding="utf-8"))
for m in M:
    path = f"{wd}/{m['path']}"
    src = open(path, encoding="utf-8").read()
    if src.count(m["old"]) != 1:
        print(m["name"], "| MUTATION NOT APPLIED", flush=True)
        continue
    open(path, "w", encoding="utf-8").write(src.replace(m["old"], m["new"]))
    try:
        test_type = m.get("type", "integration:http")
        cmd = ["../../infra/test-env.sh", "env", f"TEST_TYPE={test_type}", "NODE_OPTIONS=--experimental-vm-modules",
               "pnpm", "exec", "jest", "--runInBand", "--forceExit", m["spec"], "-t", m["t"]]
        p = subprocess.run(cmd, cwd=wd, capture_output=True, text=True, timeout=900)
        out = p.stdout + p.stderr
        line = [l for l in out.splitlines() if l.strip().startswith("Tests:")]
        t = line[-1].strip() if line else out[-300:]
        ran = ("passed" in t) or ("failed" in t)
        if not ran:
            verdict = "INVALID RUN (no test ran)"
        elif p.returncode != 0 and "failed" in t:
            verdict = "RED (caught)"
        elif p.returncode != 0:
            verdict = "INVALID RUN"
        else:
            verdict = "GREEN (NOT caught)"
        print(m["name"], "|", verdict, "|", t, flush=True)
    finally:
        open(path, "w", encoding="utf-8").write(src)
