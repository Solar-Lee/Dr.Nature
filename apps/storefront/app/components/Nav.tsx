"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { NAV, PRODUCTS } from "@/lib/site";

function cur(pathname: string, href: string) {
  return pathname.startsWith(href) ? "page" : undefined;
}

export function Wordmark({ className = "wordmark" }: { className?: string }) {
  return (
    <Link href="/" className={className} aria-label="Dr.Nature 首頁">
      Dr<span className="dot">.</span>Nature
    </Link>
  );
}

export function CartBox({ className = "cartbox" }: { className?: string }) {
  return (
    <Link href="/account/" className={className} aria-label="購物車，0 件">
      <span>購物車</span>
      <span className="num">0</span>
    </Link>
  );
}

/** Tracks which home story section is in view so the index can mark it. */
function useStoryCurrent(enabled: boolean) {
  const [id, setId] = useState<string>("s01");
  useEffect(() => {
    if (!enabled || !("IntersectionObserver" in window)) return;
    const els = NAV.story.map((s) => document.getElementById(s.id)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (vis) setId(vis.target.id);
      },
      { threshold: [0.25, 0.5, 0.75] },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [enabled]);
  return id;
}

export function SideNav() {
  const pathname = usePathname();
  const home = pathname === "/";
  const storyId = useStoryCurrent(home);
  return (
    <aside className="sidenav" aria-label="主選單">
      <Wordmark />
      <nav className="group">
        <ul>
          <li>
            <Link href="/products/" aria-current={cur(pathname, "/products")}>
              產品
            </Link>
          </li>
          {PRODUCTS.map((p) => (
            <li key={p.handle}>
              <Link href={`/products/${p.handle}/`} className="sub" aria-current={cur(pathname, `/products/${p.handle}`)}>
                <span className="num">{p.num}</span>
                {p.short}
              </Link>
            </li>
          ))}
          {NAV.primary.map((n) => (
            <li key={n.href}>
              <Link href={n.href} aria-current={cur(pathname, n.href)}>
                {n.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <nav className="group story" aria-label="首頁故事">
        <div className="story-head">首頁故事 STORY</div>
        <ul>
          {NAV.story.map((s) => (
            <li key={s.id}>
              <Link href={`/#${s.id}`} aria-current={home && storyId === s.id ? "location" : undefined}>
                <span className="num">{s.num}</span>
                {s.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="foot">
        <CartBox />
      </div>
    </aside>
  );
}

export function TopBar() {
  return (
    <header className="topbar">
      <Wordmark />
      <div className="topbar-right">
        <CartBox />
        <details className="menu">
          <summary aria-label="開啟選單">選單</summary>
          <div className="menu-panel">
            <ul>
              <li>
                <Link href="/products/">產品</Link>
              </li>
              {PRODUCTS.map((p) => (
                <li key={p.handle} className="sub">
                  <Link href={`/products/${p.handle}/`}>
                    {p.num} {p.name}
                  </Link>
                </li>
              ))}
              {NAV.primary.map((n) => (
                <li key={n.href}>
                  <Link href={n.href}>{n.label}</Link>
                </li>
              ))}
              {NAV.service.map((n) => (
                <li key={n.href} className="sub">
                  <Link href={n.href}>{n.label}</Link>
                </li>
              ))}
            </ul>
          </div>
        </details>
      </div>
    </header>
  );
}
