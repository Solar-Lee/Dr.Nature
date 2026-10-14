import type { Metadata } from "next";
import Link from "next/link";
import { lines, page, section } from "@/lib/content";

const p = page("story");
export const metadata: Metadata = { title: p.title, description: p.meta_description };

export default function Story() {
  const open = lines(section("story", "story-open"));
  const series = section("story", "series");
  const onePage = section("story", "one-page");
  const audience = section("story", "audience");
  const pillars = lines(section("story", "pillars"));
  return (
    <>
      <header className="page-head">
        <div className="wrap">
          <h1 className="enter">{open[0]}</h1>
        </div>
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
        <div className="wrap series">
          <div className="prose">
            <h2 data-reveal>{series.heading}</h2>
            <p data-reveal style={{ marginTop: 16 }}>
              {series.body}
            </p>
            <h2 data-reveal style={{ marginTop: 48 }}>
              {onePage.heading}
            </h2>
            <p data-reveal style={{ marginTop: 16 }}>
              {onePage.body}
            </p>
            <p data-reveal style={{ marginTop: 24 }}>
              <Link href="/products/" className="btn ghost">
                看三款產品 <span className="arrow">→</span>
              </Link>
            </p>
          </div>
          <div className="prose">
            <h2 data-reveal>{audience.heading}</h2>
            <p data-reveal style={{ marginTop: 16 }}>
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
          <dl className="pillars">
            {pillars.map((l, i) => {
              const [head, ...rest] = l.split("：");
              const [zh, en] = head.split(" ");
              return (
                <div className="pillar" key={head} data-reveal style={{ ["--i" as string]: i }}>
                  <dt>
                    <span className="num">0{i + 1}</span>
                    {zh}
                    <small>{en}</small>
                  </dt>
                  <dd>{rest.join("：")}</dd>
                </div>
              );
            })}
          </dl>
        </div>
      </section>
    </>
  );
}
