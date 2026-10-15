"use client";

// Scroll choreography for the home page (GSAP 3.15 ScrollTrigger), after the two "Scroll up"
// references and DESIGN's prototype:
//   01 hero      held under 02 as it slides over (CSS sticky, see globals.css motion block);
//                02 enters with a staircase column wipe
//   03 三個編號   stage pinned for three steps; the numbers, tabs and the 3D label cycle 01→02→03
//                and the bottle turns with the scroll
//   04 日常      the full-bleed panel shrinks into an inset card
//   05 習慣      the scene cards drift sideways with the scroll
//   06 讀懂自然   the wide panel scales down as the marquee arrives
// Everything is skipped under prefers-reduced-motion (static layout, nothing pinned), and the
// preference is followed live: switching it mid-visit builds or reverts the choreography.
import { useEffect } from "react";
import type { RefObject } from "react";
import type { Bottle3DHandle } from "./Bottle3D";

type Step = { num: string; name: string };

export function ScrollFX({ bottle, steps }: { bottle: RefObject<Bottle3DHandle | null>; steps: Step[] }) {
  useEffect(() => {
    let mm: { revert: () => void } | null = null;
    let cancelled = false;
    let loading = false;
    // Once the visitor scrolls on their own, a late deep-link correction must not move the page.
    let userMoved = false;
    const moved = () => {
      userMoved = true;
    };
    const intents = ["wheel", "touchmove", "keydown", "pointerdown"] as const;
    intents.forEach((t) => window.addEventListener(t, moved, { passive: true, once: true }));
    // GSAP is fetched only once motion is allowed (now or after the visitor changes the setting);
    // from then on gsap.matchMedia builds the choreography while the preference is
    // "no-preference" and reverts it (pins, tweens, html.fx) when it turns to "reduce".
    const motionOk = matchMedia("(prefers-reduced-motion: no-preference)");
    const boot = async () => {
      if (loading || !motionOk.matches) return;
      loading = true;
      motionOk.removeEventListener("change", boot);
      const { gsap } = await import("gsap");
      const { ScrollTrigger } = await import("gsap/ScrollTrigger");
      if (cancelled) return;
      gsap.registerPlugin(ScrollTrigger);
      // Phones: an address bar hiding/showing (< 25% of the height) must not re-measure the pins mid
      // scroll; the choreographed heights use svh so nothing depends on that refresh. Explicit, so
      // it does not hang on GSAP's touch-only default.
      ScrollTrigger.config({ ignoreMobileResize: true });
      // Below 1024px the sticky top bar (56px) stays over the page: both pins start under it so the
      // hero copy and the 03 kicker are never hidden. Functions, so every refresh re-measures.
      const bar = () => {
        const t = document.querySelector<HTMLElement>(".topbar");
        return t && getComputedStyle(t).display !== "none" ? t.offsetHeight : 0;
      };
      const media = gsap.matchMedia();
      mm = media;
      media.add("(prefers-reduced-motion: no-preference)", () => {
        let alive = true;
        document.documentElement.classList.add("fx");
        // 01 → 02: the hero stays under the dark panel (position: sticky in the .stick wrapper, so
        // it never flips to position: fixed mid-scroll -- that flip registered as layout shifts,
        // CLS 0.63 per pass under wheel input); the panel's dark columns rise in a staircase.
        // The hero stays put for its own height, as the former pin did; the wrapper ends with 02,
        // which can be shorter, so it is extended by the difference (--stick-extra; 03 is pulled
        // back up by as much, so nothing below moves), measured before every refresh.
        const stick = document.querySelector<HTMLElement>(".stick");
        const fitStick = () => {
          const hero = document.getElementById("s01");
          const s02 = document.getElementById("s02");
          if (stick && hero && s02) stick.style.setProperty("--stick-extra", `${Math.max(0, hero.offsetHeight - s02.offsetHeight)}px`);
        };
        fitStick();
        ScrollTrigger.addEventListener("refreshInit", fitStick);
        gsap.fromTo(
          "#s02 .stairs span",
          { scaleY: 0 },
          {
            scaleY: 1,
            ease: "none",
            stagger: { each: 0.06, from: "start" },
            scrollTrigger: { trigger: "#s02", start: "top bottom", end: "top 30%", scrub: true },
          },
        );
        gsap.fromTo(
          "#s02 h2",
          { autoAlpha: 0, y: 24 },
          { autoAlpha: 1, y: 0, ease: "none", scrollTrigger: { trigger: "#s02", start: "top 45%", end: "top 10%", scrub: true } },
        );

        // 03: pinned stage, three steps.
        const n = steps.length;
        let active = -1;
        const setActive = (i: number) => {
          if (i === active) return;
          active = i;
          document.querySelectorAll<HTMLElement>("#s03 [data-step]").forEach((el) => {
            el.toggleAttribute("data-active", Number(el.dataset.step) === i);
          });
          document.querySelectorAll<HTMLElement>("#s03 .tabs a").forEach((a, k) => {
            if (k === i) a.setAttribute("aria-current", "true");
            else a.removeAttribute("aria-current");
          });
          bottle.current?.setLabel(steps[i].num, steps[i].name);
        };
        setActive(0); // matches the server markup until the trigger reports its progress
        // Step, bottle turn and tab fills all follow the progress. Called on refresh too: GSAP runs
        // onRefresh after the refresh's own update, so resetting to 01 there would contradict the
        // progress after a resize, rotation or tab return while the stage is pinned.
        const apply = (p: number) => {
          setActive(Math.min(n - 1, Math.floor(p * n)));
          bottle.current?.setScrollRotation(p * Math.PI * 2 * 0.9);
          document.querySelectorAll<HTMLElement>("#s03 .tabs a").forEach((a, k) => {
            const local = Math.max(0, Math.min(1, p * n - k));
            a.style.setProperty("--fill", String(local));
          });
        };
        ScrollTrigger.create({
          trigger: "#s03",
          start: () => `top ${bar()}px`,
          end: () => `+=${window.innerHeight * n}`,
          pin: "#s03 .three",
          scrub: true,
          invalidateOnRefresh: true,
          onUpdate: (self) => apply(self.progress),
          onRefresh: (self) => apply(self.progress),
        });

        // 04: the daily panel shrinks into an inset card as it settles.
        gsap.fromTo(
          "#s04 .daily-panel",
          { scale: 1, borderRadius: 0 },
          { scale: 0.9, borderRadius: 12, ease: "none", transformOrigin: "50% 100%", scrollTrigger: { trigger: "#s04 .daily-panel", start: "top 70%", end: "bottom 60%", scrub: true } },
        );

        // 05: the scene cards drift sideways with the scroll (no hijack, just parallax). GSAP owns the
        // cards' whole transform here, odd-card stagger included: it is set explicitly instead of
        // being read from the CSS, which the reveal transition may be animating at that moment
        // (WebKit captured a mid-transition offset). The reveal keeps only its fade under .fx.
        const scenes = document.querySelector<HTMLElement>("#s05 .scenes");
        if (scenes) {
          const travel = () => Math.max(0, scenes.scrollWidth - scenes.clientWidth) * 0.6;
          const stagger = (i: number) => (i % 2 === 0 ? -28 : 0);
          gsap.fromTo(
            "#s05 .scenes > *",
            { x: 0, y: stagger },
            { x: () => -travel(), y: stagger, ease: "none", scrollTrigger: { trigger: "#s05", start: "top bottom", end: "bottom top", scrub: true, invalidateOnRefresh: true } },
          );
        }

        // 06: the wide panel scales down as the marquee arrives.
        gsap.fromTo(
          "#s06 .wide",
          { scale: 1 },
          { scale: 0.94, ease: "none", transformOrigin: "50% 100%", scrollTrigger: { trigger: "#s06 .wide", start: "top 60%", end: "bottom 40%", scrub: true } },
        );
        ScrollTrigger.refresh();

        // A cold load of /#s0N (the side index on every other page links there) jumps before the pin
        // spacers exist, and the browser's own (smooth) fragment scroll may still be running, so the
        // section ends up off its start. Land on the pinned start (or the section top under the top
        // bar) once everything is measured, and hold it for a few frames against that animation.
        const landOnHash = () => {
          const id = location.hash.slice(1);
          if (userMoved || !/^s0[1-6]$/.test(id)) return;
          const el = document.getElementById(id);
          if (!el) return;
          const pinned = ScrollTrigger.getAll().find((t) => t.trigger === el && t.pin);
          // A stuck hero reports its stuck position; its place in the flow is its wrapper's top.
          const flow = el.parentElement?.classList.contains("stick") && el === el.parentElement.firstElementChild ? el.parentElement : el;
          const top = Math.max(0, Math.round(pinned ? pinned.start : flow.getBoundingClientRect().top + window.scrollY - bar()));
          let frames = 0;
          const hold = () => {
            if (cancelled || !alive || userMoved) return;
            if (Math.abs(window.scrollY - top) > 1) window.scrollTo({ top, behavior: "instant" });
            if (++frames < 12) requestAnimationFrame(hold);
          };
          hold();
        };
        landOnHash();

        // Web fonts still loading at setup can reflow text above the pins when they arrive; measure
        // again then (and keep a deep link on its section unless the visitor has scrolled).
        if (document.fonts.status !== "loaded") {
          document.fonts.ready.then(() => {
            if (cancelled || !alive) return;
            ScrollTrigger.refresh();
            landOnHash();
          });
        }

        // Reverted (motion turned to "reduce", or unmount): back to the static layout's 03 state.
        return () => {
          alive = false;
          ScrollTrigger.removeEventListener("refreshInit", fitStick);
          stick?.style.removeProperty("--stick-extra");
          document.documentElement.classList.remove("fx");
          document.querySelectorAll<HTMLElement>("#s03 .tabs a").forEach((a) => a.style.removeProperty("--fill"));
          setActive(0);
          bottle.current?.setScrollRotation(0);
        };
      });
    };
    motionOk.addEventListener("change", boot);
    void boot();
    return () => {
      cancelled = true;
      motionOk.removeEventListener("change", boot);
      intents.forEach((t) => window.removeEventListener(t, moved));
      mm?.revert();
      document.documentElement.classList.remove("fx");
    };
  }, [bottle, steps]);
  return null;
}
