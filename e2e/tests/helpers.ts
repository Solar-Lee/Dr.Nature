// Shared fixtures for the storefront matrix. Assertions read behaviour (computed position, GSAP's
// scaleY, data-active), never pixel positions, because the layout keeps changing.
import { test as base, expect, type Page } from "@playwright/test";

/** Pinned elements may sit under the mobile top bar, so "at the top" means 0..64px. */
export const PIN_TOP_MAX = 64;

export const test = base.extend<{ errors: string[] }>({
  // Every console error and uncaught page error of the test; each test asserts the list is empty.
  // Requests to other hosts (Google Fonts) get an empty 200 so the run never depends on the
  // network: this suite therefore cannot prove that the web font loads.
  errors: async ({ page, baseURL }, use) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 300)}`);
    });
    page.on("pageerror", (e) => errors.push(`pageerror: ${String(e.message).slice(0, 300)}`));
    const own = new URL(baseURL ?? "http://127.0.0.1").host;
    await page.route(
      (url) => url.host !== own,
      (route) => {
        const css = route.request().resourceType() === "stylesheet";
        return route.fulfill({ status: 200, contentType: css ? "text/css" : "text/plain", body: "" });
      },
    );
    await use(errors);
  },
});

export { expect };

/** Opens the home page and waits until hydration and the lazy chunks have settled. */
export async function openHome(page: Page) {
  await page.goto("/", { waitUntil: "load" });
  await page.waitForLoadState("networkidle");
}

/** Scrolls without smooth scrolling, then lets two frames pass so ScrollTrigger has updated. */
export async function scrollToY(page: Page, y: number) {
  await page.evaluate((top) => {
    document.documentElement.style.scrollBehavior = "auto";
    window.scrollTo({ top: Math.round(top), behavior: "instant" as ScrollBehavior });
  }, y);
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}

/** Document positions of the story sections, measured from the top of the page. */
export async function sectionTops(page: Page) {
  await scrollToY(page, 0);
  return page.evaluate(() => {
    const top = (sel: string) => {
      const el = document.querySelector(sel);
      return el ? el.getBoundingClientRect().top + window.scrollY : NaN;
    };
    return { s01: top("#s01"), s02: top("#s02"), s03: top("#s03"), vh: window.innerHeight };
  });
}

/** Computed position and viewport top of one element. */
export function placement(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { position: "missing", top: NaN };
    return { position: getComputedStyle(el).position, top: Math.round(el.getBoundingClientRect().top) };
  }, selector);
}

/** scaleY of every staircase column in 02 (1 when no transform is set). */
export function stairScales(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("#s02 .stairs span")].map((el) => {
      const t = getComputedStyle(el).transform;
      if (!t || t === "none") return 1;
      const v = (t.match(/\(([^)]+)\)/)?.[1] ?? "").split(",").map(Number);
      return t.startsWith("matrix3d") ? v[5] : v[3];
    }),
  );
}

/** Index of the 03 step that carries data-active, or null. */
export function activeStep(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>("#s03 [data-step][data-active]");
    return el ? Number(el.dataset.step) : null;
  });
}
