import Link from "next/link";

export type Crumb = { href?: string; label: string };

/**
 * Visible trail (UX-13). The last item is the current page (aria-current, not a link).
 * P6-04's BreadcrumbList JSON-LD should mirror the same items.
 */
export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="路徑" className="crumbs">
      <ol>
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${i}-${c.label}`}>
              {i > 0 && (
                <span className="sep" aria-hidden="true">
                  ›
                </span>
              )}
              {last || !c.href ? <span aria-current={last ? "page" : undefined}>{c.label}</span> : <Link href={c.href}>{c.label}</Link>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
