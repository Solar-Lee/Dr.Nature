import type { Metadata } from "next";
import { JOURNAL } from "@/lib/site";
import { JournalIndex } from "./JournalIndex";

export const metadata: Metadata = { title: "知識誌", description: `Dr.Nature 知識誌：${JOURNAL.categories.slice(1).join("、")}。所有文章發布前經內部合規複核。`, alternates: { canonical: "/journal/" } };

// Category tabs link to the static pages /journal/c/<slug>/ (app/journal/c/[cat]/page.tsx).
export default function Journal() {
  return <JournalIndex current={JOURNAL.all} />;
}
