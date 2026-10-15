import Link from "next/link";
import { JournalGrid } from "../components/Blocks";
import { JOURNAL } from "@/lib/site";

/**
 * 知識誌 index shared by /journal/ and the static category pages /journal/c/<slug>/:
 * heading, category tabs (aria-current="page" on the tab of this page) and the post grid.
 * `current` is JOURNAL.all or a category name from JOURNAL.cats.
 */
export function JournalIndex({ current }: { current: string }) {
  const all = current === JOURNAL.all;
  const count = all ? JOURNAL.posts.length : JOURNAL.posts.filter((p) => p.cat === current).length;
  return (
    <>
      <div className="jhead">
        <h1>
          {JOURNAL.title}
          <span className="en">{JOURNAL.en}</span>
        </h1>
        <span className="muted" style={{ fontSize: 13 }}>
          {all ? "" : `${current} · `}
          {count} 篇規劃中 · {JOURNAL.note}
        </span>
      </div>
      <nav className="jtabs" aria-label="分類">
        {JOURNAL.categories.map((c) => (
          <Link key={c} href={JOURNAL.href(c)} aria-current={c === current ? "page" : undefined}>
            {c}
          </Link>
        ))}
      </nav>
      <JournalGrid cat={current} />
    </>
  );
}
