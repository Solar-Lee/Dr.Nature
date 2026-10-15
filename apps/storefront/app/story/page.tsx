import type { Metadata } from "next";
import Link from "next/link";
import { lines, page, section, slogan } from "@/lib/content";

const p = page("story");
export const metadata: Metadata = { title: "品牌故事", description: p.meta_description };

export default function Story() {
  const open = lines(section("story", "story-open"));
  const series = section("story", "series");
  const onePage = section("story", "one-page");
  const audience = section("story", "audience");
  const pillars = lines(section("story", "pillars"));
  // The opener band carries the main slogan (slogan.md:52 lists 品牌頁 H1 as its place; G5 decided
  // 2026-10-15). It used to repeat HOME.s02, which is now the story's first sentence (story.md:148)
  // and would duplicate the h1 below.
  const [sloganA, sloganB] = slogan.split(/(?<=，)/);
  return (
    <>
      <section className="dark" aria-label="品牌故事開場">
        <span className="kicker" style={{ color: "#e8e7e2" }}>
          品牌故事
        </span>
        <h2 style={{ marginTop: 16 }}>
          {sloganA}
          <br />
          {sloganB}
        </h2>
      </section>
      <header className="page-head">
        <h1 className="enter">{open[0]}</h1>
      </header>
      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap prose">
          {open.slice(1).map((l) => (
            <p key={l} className="lede" data-reveal>
              {l}
            </p>
          ))}
        </div>
      </section>
      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap two">
          <div className="prose">
            <h2 data-reveal>{series.heading}</h2>
            <p data-reveal style={{ marginTop: 14 }}>
              {series.body}
            </p>
            <h2 data-reveal style={{ marginTop: 40 }}>
              {onePage.heading}
            </h2>
            <p data-reveal style={{ marginTop: 14 }}>
              {onePage.body}
            </p>
            <p data-reveal style={{ marginTop: 22 }}>
              <Link href="/products/" className="btn ghost">
                認識三款益生菌 <span className="arrow">→</span>
              </Link>
            </p>
          </div>
          <div className="prose">
            <h2 data-reveal>{audience.heading}</h2>
            <p data-reveal style={{ marginTop: 14 }}>
              {audience.body}
            </p>
          </div>
        </div>
      </section>
      <section className="section" style={{ paddingTop: 0 }} aria-labelledby="pillars-title">
        <div className="wrap">
          <h2 id="pillars-title" data-reveal>
            三個精神支柱
          </h2>
          <dl style={{ margin: "28px 0 0" }}>
            {pillars.map((l, i) => {
              const [head, ...rest] = l.split("：");
              const [zh, en] = head.split(" ");
              return (
                <div key={head} data-reveal style={{ ["--i" as string]: i, borderTop: "1px solid var(--ink)", padding: "22px 0", display: "grid", gap: 6 }}>
                  <dt style={{ fontWeight: 700, fontSize: "1.5rem" }}>
                    <span className="num" style={{ color: "var(--red)", fontSize: 13, marginRight: 12 }}>
                      0{i + 1}
                    </span>
                    {zh} <span className="en" style={{ fontSize: "0.6em" }}>{en}</span>
                  </dt>
                  <dd className="muted" style={{ margin: 0, maxWidth: "34em" }}>
                    {rest.join("：")}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      </section>
    </>
  );
}
