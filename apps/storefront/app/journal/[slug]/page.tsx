import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Slot } from "../../components/Blocks";
import { JOURNAL } from "@/lib/site";

type Params = { slug: string };
export const dynamicParams = false;
export function generateStaticParams(): Params[] {
  return JOURNAL.posts.map((p) => ({ slug: p.slug }));
}
export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const p = JOURNAL.posts.find((x) => x.slug === slug);
  return { title: p ? p.title : "知識誌" };
}

export default async function Post({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const p = JOURNAL.posts.find((x) => x.slug === slug);
  if (!p) notFound();
  return (
    <article>
      <header className="page-head">
        <span className="kicker">{p.cat}</span>
        <h1 className="enter">{p.title}</h1>
        <p className="muted">{JOURNAL.note}</p>
      </header>
      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap" style={{ display: "grid", gap: 24, maxWidth: 820 }}>
          <Slot label="文章主圖 1200×800" note="圖片製作中" style={{ aspectRatio: "3 / 2" }} />
          <div className="prose">
            <p>這一篇還在撰寫中。文章內容會先經過食品標示與廣告法規審核，才會發布。</p>
            <p>
              <Link href="/journal/" className="textlink">
                回知識誌
              </Link>
            </p>
          </div>
        </div>
      </section>
    </article>
  );
}
