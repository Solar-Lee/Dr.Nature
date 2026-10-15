// [P11-02a] Home page across engines and devices: 3D, scroll choreography (01 pin, 02 staircase,
// 03 pinned three-step stage, also scrolling back up), reduced motion, the mobile menu, the 404 page.
// What this cannot prove: how it looks (no screenshot baselines yet), real GPU behaviour on a phone,
// that the Google web font loads (stubbed, see helpers.ts), or anything behind the backend.
import { test, expect, PIN_TOP_MAX, openHome, scrollToY, sectionTops, placement, stairScales, activeStep } from "./helpers";

test("home loads: three 3D canvases, no sideways overflow, no console errors", async ({ page, errors }) => {
  await openHome(page);
  // Walk down the page once so lazily started bottles get their canvas, then back to the top.
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const vh = await page.evaluate(() => window.innerHeight);
  for (let y = 0; y < height; y += vh) await scrollToY(page, y);
  await scrollToY(page, 0);
  await expect.poll(() => page.locator("canvas").count(), { message: "WebGL canvases on /" }).toBe(3);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "horizontal overflow in px").toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test("hero is pinned while 02 slides over it", { tag: "@motion" }, async ({ page, errors }) => {
  await openHome(page);
  await expect(page.locator("html")).toHaveClass(/\bfx\b/);
  const s = await sectionTops(page);
  for (const f of [0.3, 0.8]) {
    await scrollToY(page, s.s01 + (s.s02 - s.s01) * f);
    // The hero is held either by a ScrollTrigger pin (position: fixed) or, since MO-12, by CSS
    // position: sticky; the behaviour under test is that it stays at the top while 02 slides over it.
    await expect.poll(async () => (await placement(page, "#s01")).position, { message: `#s01 at ${f} of the pin range` }).toMatch(/^(fixed|sticky)$/);
    const { top } = await placement(page, "#s01");
    expect(top, `#s01 top at ${f} of the pin range`).toBeGreaterThanOrEqual(0);
    expect(top, `#s01 top at ${f} of the pin range`).toBeLessThanOrEqual(PIN_TOP_MAX);
  }
  expect(errors).toEqual([]);
});

test("02 staircase columns rise with the scroll and are fully up when 02 reaches the top", { tag: "@motion" }, async ({ page, errors }) => {
  await openHome(page);
  await expect(page.locator("html")).toHaveClass(/\bfx\b/);
  const s = await sectionTops(page);
  const start = await stairScales(page);
  expect(start.length, "staircase columns").toBeGreaterThan(0);
  expect(Math.min(...start), "first column before 02 enters").toBeLessThan(0.5);
  await scrollToY(page, s.s02);
  await expect.poll(async () => Math.min(...(await stairScales(page))), { message: "lowest column scaleY at the end of 02" }).toBeGreaterThanOrEqual(0.99);
  expect(errors).toEqual([]);
});

test("03 stage stays pinned and cycles 01→02→03, and back when scrolling up", { tag: "@motion" }, async ({ page, errors }) => {
  await openHome(page);
  await expect(page.locator("html")).toHaveClass(/\bfx\b/);
  const s = await sectionTops(page);
  const stops: Array<[number, number]> = [
    [0.5, 0],
    [1.5, 1],
    [2.5, 2],
    [1.5, 1],
    [0.5, 0],
  ];
  for (const [k, want] of stops) {
    await scrollToY(page, s.s03 + k * s.vh);
    await expect.poll(() => activeStep(page), { message: `active step at ${k} viewports into #s03` }).toBe(want);
    const three = await placement(page, "#s03 .three");
    expect(three.position, `#s03 .three at ${k} viewports`).toBe("fixed");
    expect(three.top).toBeGreaterThanOrEqual(0);
    expect(three.top).toBeLessThanOrEqual(PIN_TOP_MAX);
  }
  expect(errors).toEqual([]);
});

test("reduced motion: nothing is pinned and the choreography is off", { tag: "@reduced" }, async ({ page, errors }) => {
  await openHome(page);
  // Bottles start their WebGL context only near the viewport (PF-03), under reduced motion too:
  // walk the page once, then all three canvases must exist and none may be pinned.
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const vh = await page.evaluate(() => window.innerHeight);
  for (let y = 0; y < height; y += vh) await scrollToY(page, y);
  await scrollToY(page, 0);
  await expect.poll(() => page.locator("canvas").count(), { message: "WebGL canvases on / under reduced motion" }).toBe(3);
  await expect(page.locator("html")).not.toHaveClass(/\bfx\b/);
  const s = await sectionTops(page);
  for (const f of [0.3, 0.8]) {
    await scrollToY(page, s.s01 + (s.s02 - s.s01) * f);
    expect((await placement(page, "#s01")).position, `#s01 at ${f} of the would-be pin range`).not.toMatch(/^(fixed|sticky)$/);
  }
  await scrollToY(page, s.s03 + 1.5 * s.vh);
  expect((await placement(page, "#s03 .three")).position).not.toBe("fixed");
  expect(await page.locator(".pin-spacer").count(), "GSAP pin spacers").toBe(0);
  expect(errors).toEqual([]);
});

test("mobile menu opens from the top bar", { tag: "@mobile" }, async ({ page, errors }) => {
  await openHome(page);
  const bar = page.locator(".topbar");
  await expect(bar).toBeVisible();
  const products = bar.locator('a[href="/products/"]');
  await expect(products).toBeHidden();
  await bar.locator("summary, button").filter({ hasText: "選單" }).first().click();
  await expect(products).toBeVisible();
  expect(errors).toEqual([]);
});

test("404 page has a title and its heading", async ({ page, errors }) => {
  const res = await page.goto("/404.html");
  expect(res?.ok(), "the exported 404.html is served").toBe(true);
  await expect(page).toHaveTitle(/Dr\.Nature/);
  await expect(page.locator("h1")).toContainText("找不到");
  expect(errors).toEqual([]);
});
