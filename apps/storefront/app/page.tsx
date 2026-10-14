import type { Metadata } from "next";
import Link from "next/link";
import { Bottle } from "./components/Bottle";
import { bottleNumber, lines, page, products, section, slogan, sloganEn } from "@/lib/content";

const home = page("home");
export const metadata: Metadata = { title: home.title, description: home.meta_description };

export default function Home() {
  const hero = lines(section("home", "hero"));
  const notebook = section("home", "notebook");
  const series = section("home", "series");
  const drName = section("home", "dr-in-name");
  const pillars = lines(section("home", "pillars"));
  const repeat = section("home", "repeat");
  const first = products[0];

  return (
    <>
      {/* Hero: slogan block only (slogan.md 三: never next to function sentences or the director). */}
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-card">
          <div className="light-sweep" aria-hidden="true" />
          <div className="hero-copy">
            <h1 id="hero-title" className="enter" style={{ ["--i" as string]: 0 }}>
              {slogan}
            </h1>
            <p className="en enter" style={{ ["--i" as string]: 1 }}>
              {sloganEn}
            </p>
            <p className="lede enter" style={{ ["--i" as string]: 2 }}>
              {hero[1]}
            </p>
            <div className="enter" style={{ ["--i" as string]: 3 }}>
              <Link href="/products/" className="btn">
                看三款產品 <span className="arrow">→</span>
              </Link>
            </div>
          </div>
          <div className="hero-visual">
            <div className="stand">
              <Bottle num={bottleNumber(first)} name="60 顆膠囊" tint={1} width={200} dolly float />
            </div>
            <span className="figure-note">瓶身示意，非實物</span>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <p className="statement" data-reveal>
            {lines(notebook)[0]}
          </p>
          <p style={{ marginTop: 28 }} data-reveal>
            <Link href="/story/" className="textlink">
              讀品牌故事
            </Link>
          </p>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }} aria-labelledby="series-title">
        <div className="wrap series">
          <div>
            <h2 id="series-title" data-reveal>
              {series.heading}
            </h2>
            <div className="facts" data-reveal>
              <div className="fact">
                <b>60</b>
                <span>顆膠囊</span>
              </div>
              <div className="fact">
                <b>2 年</b>
                <span>效期</span>
              </div>
              <div className="fact">
                <b>NT$1,150</b>
                <span>官網售價</span>
              </div>
            </div>
            <p className="prose muted" data-reveal>
              {lines(series)[0].split("。").slice(1).join("。").trim()}
            </p>
            <p style={{ marginTop: 24 }} data-reveal>
              <Link href="/products/" className="btn ghost">
                看三款產品 <span className="arrow">→</span>
              </Link>
            </p>
          </div>
          <div className="series-stage" data-reveal>
            <div className="trio">
              {products.map((p, i) => (
                <Link key={p.handle} href={`/products/${p.handle}/`} aria-label={p.display_name}>
                  <Bottle num={bottleNumber(p)} name="60 顆膠囊" tint={(i + 1) as 1 | 2 | 3} width={118} />
                </Link>
              ))}
            </div>
            <div className="plinth" />
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap centered">
          <p className="statement" data-reveal>
            {drName.body}
          </p>
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
              const en = ["Record", "Restraint", "Safe to Repeat"][i];
              return (
                <div className="pillar" key={head} data-reveal style={{ ["--i" as string]: i }}>
                  <dt>
                    <span className="num">0{i + 1}</span>
                    {head}
                    <small>{en}</small>
                  </dt>
                  <dd>{rest.join("：")}</dd>
                </div>
              );
            })}
          </dl>
        </div>
      </section>

      <section className="section" style={{ padding: "0 0 clamp(64px, 9vw, 128px)" }}>
        <div className="band" data-reveal>
          <div className="wrap" style={{ display: "grid", gap: 20 }}>
            <h2>{repeat.heading}</h2>
            <p className="muted" style={{ maxWidth: "36em" }}>
              {repeat.body}
            </p>
            <div>
              <Link href="/story/" className="btn ghost">
                讀品牌故事 <span className="arrow">→</span>
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
