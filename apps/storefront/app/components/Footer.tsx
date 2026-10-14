import Link from "next/link";
import { LEGAL, NAV, lines, site } from "@/lib/content";

export function Footer() {
  const foot = lines(site.sections.footer);
  return (
    <footer className="footer">
      <nav aria-label="頁尾選單">
        <ul>
          {[...NAV, ...LEGAL].map((n) => (
            <li key={n.href}>
              <Link href={n.href}>{n.label}</Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="small">
        {foot.map((l) => (
          <p key={l}>{l}</p>
        ))}
      </div>
      <p className="giant" aria-hidden="true" data-reveal>
        Dr<span className="dot">.</span>Nature
      </p>
    </footer>
  );
}
