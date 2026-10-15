"use client";

// Scroll choreography for the home page (GSAP 3.15 ScrollTrigger), after the two "Scroll up"
// references and DESIGN's prototype:
//   01 hero      pinned while 02 slides over it; 02 enters with a staircase column wipe
//   03 三個編號   stage pinned for three steps; the numbers, tabs and the 3D label cycle 01→02→03
//                and the bottle turns with the scroll
//   04 日常      the full-bleed panel shrinks into an inset card
//   05 習慣      the scene cards drift sideways with the scroll
//   06 讀懂自然   the wide panel scales down as the marquee arrives
// Everything is skipped under prefers-reduced-motion (static layout, nothing pinned).
import { useEffect } from "react";
import type { RefObject } from "react";
import type { Bottle3DHandle } from "./Bottle3D";

type Step = { num: string; name: string };

export function ScrollFX({ bottle, steps }: { bottle: RefObject<Bottle3DHandle | null>; steps: Step[] }) {
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let ctx: { revert: () => void } | null = null;
    let cancelled = false;
    (async () => {
      const { gsap } = await import("gsap");
      const { ScrollTrigger } = await import("gsap/ScrollTrigger");
      if (cancelled) return;
      gsap.registerPlugin(ScrollTrigger);
      document.documentElement.classList.add("fx");
      ctx = gsap.context(() => {
        // 01 → 02: pin the hero under the dark panel; the panel's dark columns rise in a staircase.
        ScrollTrigger.create({ trigger: "#s01", start: "top top", end: "bottom top", pin: true, pinSpacing: false });
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
          start: "top top",
          end: () => `+=${window.innerHeight * n}`,
          pin: "#s03 .three",
          scrub: true,
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
      });
      ScrollTrigger.refresh();
    })();
    return () => {
      cancelled = true;
      ctx?.revert();
      document.documentElement.classList.remove("fx");
    };
  }, [bottle, steps]);
  return null;
}
