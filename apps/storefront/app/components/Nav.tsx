"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LEGAL, NAV, products, bottleNumber } from "@/lib/content";

function isCurrent(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

export function Wordmark({ className = "wordmark" }: { className?: string }) {
  return (
    <Link href="/" className={className} aria-label="Dr.Nature 首頁">
      Dr<span className="dot">.</span>Nature
    </Link>
  );
}

export function SideNav() {
  const pathname = usePathname();
  return (
    <aside className="sidenav" aria-label="主選單">
      <Wordmark />
      <nav className="group">
        <ul>
          {NAV.map((n) => (
            <li key={n.href}>
              <Link href={n.href} className="nav-link" aria-current={isCurrent(pathname, n.href) ? "page" : undefined}>
                {n.label}
              </Link>
            </li>
          ))}
        </ul>
        <ul>
          {products.map((p) => (
            <li key={p.handle}>
              <Link
                href={`/products/${p.handle}/`}
                className="nav-link"
                aria-current={pathname.startsWith(`/products/${p.handle}`) ? "page" : undefined}
              >
                <span className="num">{bottleNumber(p)}</span>
                {p.display_name.replace("Dr.Nature ", "").replace("（名稱待定）", "")}
              </Link>
            </li>
          ))}
        </ul>
        <ul>
          {LEGAL.map((n) => (
            <li key={n.href}>
              <Link href={n.href} className="nav-link" aria-current={isCurrent(pathname, n.href) ? "page" : undefined}>
                {n.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="foot">
        <span className="tag">預覽版</span>
      </div>
    </aside>
  );
}

export function TopBar() {
  return (
    <header className="topbar">
      <Wordmark />
      <details className="menu">
        <summary aria-label="開啟選單">選單</summary>
        <div className="menu-panel">
          <ul>
            {[...NAV, ...LEGAL].map((n) => (
              <li key={n.href}>
                <Link href={n.href}>{n.label}</Link>
              </li>
            ))}
          </ul>
        </div>
      </details>
    </header>
  );
}
