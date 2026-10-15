"use client";

import { useEffect, useState } from "react";

// WCAG 2.2.2 (Pause, Stop, Hide): the 06 marquee and the 3D bottles move on their own for more
// than 5 s, so visitors get one site-wide switch. Shared contract between lanes:
//   - paused  -> <html data-motion="paused">; running -> the attribute is removed
//   - the choice persists in localStorage "drn-motion" ("paused" | "running")
//   - every change dispatches window "drn:motion" (Bottle3D listens and stops auto-rotation)
// With no stored choice the initial state follows prefers-reduced-motion.
const KEY = "drn-motion";
const REDUCE = "(prefers-reduced-motion: reduce)";

function stored(): boolean | null {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === "paused" ? true : v === "running" ? false : null;
  } catch {
    return null;
  }
}

function apply(paused: boolean) {
  const root = document.documentElement;
  if (paused) root.dataset.motion = "paused";
  else delete root.dataset.motion;
  window.dispatchEvent(new CustomEvent("drn:motion"));
}

export function MotionToggle() {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia?.(REDUCE);
    const initial = stored() ?? mq?.matches ?? false;
    setPaused(initial);
    apply(initial);
    if (!mq) return;
    const follow = (e: MediaQueryListEvent) => {
      if (stored() !== null) return;
      setPaused(e.matches);
      apply(e.matches);
    };
    mq.addEventListener("change", follow);
    return () => mq.removeEventListener("change", follow);
  }, []);

  const toggle = () => {
    const next = !paused;
    setPaused(next);
    try {
      window.localStorage.setItem(KEY, next ? "paused" : "running");
    } catch {
      // private mode / blocked storage: the switch still works for this page view
    }
    apply(next);
  };

  return (
    <button type="button" className="motion-toggle" aria-pressed={paused} onClick={toggle}>
      暫停動態
    </button>
  );
}
