// [P11-02a] Every internal link in the side nav, the top bar menu and the footer resolves on the
// static server (200 after redirects). Runs once (chromium-desktop): it checks files, not engines.
// Cannot prove: nginx try_files behaves the same as the python server (see infra/nginx/drn.conf).
import { test, expect } from "./helpers";

test("every internal nav and footer link returns 200", { tag: "@once" }, async ({ page, request, errors }) => {
  await page.goto("/", { waitUntil: "load" });
  const hrefs = await page.$$eval(".sidenav a[href], .topbar a[href], .footer a[href]", (as) =>
    as.map((a) => a.getAttribute("href") ?? ""),
  );
  const paths = [...new Set(hrefs.filter((h) => h.startsWith("/")).map((h) => h.replace(/[#?].*$/, "") || "/"))];
  expect(paths.length, "internal links found").toBeGreaterThan(10);
  const bad: string[] = [];
  for (const p of paths) {
    const res = await request.get(p);
    if (res.status() !== 200) bad.push(`${p} → ${res.status()}`);
  }
  expect(bad, `checked ${paths.length} paths`).toEqual([]);
  expect(errors).toEqual([]);
});
