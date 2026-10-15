import type { Metadata } from "next";
import Link from "next/link";
import { JournalGrid } from "../components/Blocks";
import { JOURNAL } from "@/lib/site";

export const metadata: Metadata = { title: "知識誌", description: `Dr.Nature 知識誌：${JOURNAL.categories.slice(1).join("、")}。所有文章發布前都經法規審核。` };

// Static export: the category filter is client-side via the ?cat query (see JournalTabs).
export default function Journal() {
  return (
    <>
      <div className="jhead">
        <h1>
          {JOURNAL.title}
          <span className="en">{JOURNAL.en}</span>
        </h1>
        <span className="muted" style={{ fontSize: 13 }}>
          {JOURNAL.posts.length} 篇規劃中 · {JOURNAL.note}
        </span>
      </div>
      <nav className="jtabs" aria-label="分類">
        {JOURNAL.categories.map((c, i) => (
          <Link key={c} href={i === 0 ? "/journal/" : `/journal/?cat=${encodeURIComponent(c)}`} aria-current={i === 0 ? "true" : undefined}>
            {c}
          </Link>
        ))}
      </nav>
      <JournalGrid />
    </>
  );
}
