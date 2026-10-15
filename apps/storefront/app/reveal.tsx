"use client";

// Scroll reveal for the preview storefront: marks [data-reveal] elements as in view once, via
// IntersectionObserver (no scroll listeners). The CSS in globals.css does the motion and turns it
// off under prefers-reduced-motion; without JavaScript every element stays visible.
import { useEffect } from "react";
import { usePathname } from "next/navigation";

export function RevealOnScroll() {
  // Re-run on client-side navigation so the new page's elements are observed too.
  const pathname = usePathname();
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    document.documentElement.classList.add("js-reveal");
    if (!("IntersectionObserver" in window)) {
      els.forEach((el) => el.setAttribute("data-inview", ""));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.setAttribute("data-inview", "");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.15 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [pathname]);
  return null;
}
