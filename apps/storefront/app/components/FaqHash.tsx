"use client";

import { useEffect } from "react";

/**
 * Opens the FAQ item named in the URL hash (/faq/#buy, /faq/#faq-3) on load, after client
 * navigation and on hashchange, then scrolls it into view and moves focus to its summary.
 */
export function FaqHash() {
  useEffect(() => {
    const openFromHash = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      const el = document.getElementById(id);
      if (!(el instanceof HTMLDetailsElement)) return;
      el.open = true;
      el.scrollIntoView({ block: "start" });
      el.querySelector("summary")?.focus({ preventScroll: true });
    };
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, []);
  return null;
}
