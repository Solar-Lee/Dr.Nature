import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JOURNAL } from "@/lib/site";
import { JournalIndex } from "../../JournalIndex";

// One static page per 知識誌 category (static export: a ?cat= query cannot filter anything).
type Params = { cat: string };
export const dynamicParams = false;
export function generateStaticParams(): Params[] {
  return JOURNAL.cats.map((c) => ({ cat: c.slug }));
}
export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { cat } = await params;
  const c = JOURNAL.cats.find((x) => x.slug === cat);
  if (!c) return { title: JOURNAL.title };
  return { title: `${c.name}｜${JOURNAL.title}`, description: `Dr.Nature 知識誌「${c.name}」分類的文章。所有文章發布前經內部合規複核。` };
}

export default async function JournalCategory({ params }: { params: Promise<Params> }) {
  const { cat } = await params;
  const c = JOURNAL.cats.find((x) => x.slug === cat);
  if (!c) notFound();
  return <JournalIndex current={c.name} />;
}
