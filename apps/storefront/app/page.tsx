import Link from "next/link";
import { Bottle3D } from "./components/Bottle3D";
import { Greeting } from "./components/Greeting";
import { ContactBlocks, JournalGrid, Marquee, SeriesCards, Slot } from "./components/Blocks";
import { HOME, JOURNAL, PRODUCTS, SERIES, SPEC } from "@/lib/site";

// Home: the six-part story from DESIGN's prototype (01 序 … 06 讀懂自然), then the series cards,
// 知識誌, LINE / 電子報. Section ids match NAV.story so the left index tracks the scroll.
export default function Home() {
  const first = PRODUCTS[0];
  const third = PRODUCTS[2];
  return (
    <>
      <section id="s01" className="hero" aria-labelledby="hero-title">
        <div className="hero-top">
          <div className="hero-copy">
            <div className="enter" style={{ ["--i" as string]: 0 }}>
              <Greeting />
            </div>
            <h1 id="hero-title" className="enter" style={{ ["--i" as string]: 1 }}>
              {HOME.heroTitle[0]}
              <br />
              {HOME.heroTitle[1]}
            </h1>
            <div className="hero-cta enter" style={{ ["--i" as string]: 2 }}>
              <Link href="/products/" className="btn">
                {HOME.heroCta} <span className="arrow">→</span>
              </Link>
              <span className="en">{HOME.heroEn}</span>
            </div>
          </div>
          <div className="hero-meta enter" style={{ ["--i" as string]: 3 }}>
            <b>{SERIES}</b>
            {HOME.heroMeta.map((l) => (
              <span key={l} style={{ display: "block" }}>
                {l}
              </span>
            ))}
          </div>
        </div>
        <div className="hero-stage">
          <div className="hero-video" aria-hidden="true">
            <span className="tag">品牌影片（D-E01）製作中</span>
          </div>
          <Bottle3D num={first.num} name={first.name} className="stage3d tilt" tilt={0.14} scale={1.05} />
        </div>
        <p className="giant" aria-hidden="true">
          Dr<span className="dot">.</span>Nature
        </p>
      </section>

      <section id="s02" className="dark" aria-label="我們只說">
        <h2 data-reveal>
          {HOME.s02.a}
          <br />
          {HOME.s02.b1}
          <span className="inline-slot" aria-hidden="true" />
          <span className="dim">{HOME.s02.b2}</span>
        </h2>
      </section>

      <section id="s03" className="three" aria-label="三個編號">
        <div className="left">
          <span className="kicker">{HOME.s03Kicker}</span>
          <div>
            <div className="bignum" data-reveal>
              {first.num}
            </div>
            <div className="pname" data-reveal>
              {first.name}
            </div>
            <span className="ptag">{first.pendingTag}</span>
          </div>
          <nav className="tabs" aria-label="三款">
            {PRODUCTS.map((p) => (
              <Link key={p.handle} href={`/products/${p.handle}/`} aria-current={p.handle === first.handle ? "true" : undefined}>
                {p.num} {p.short}
              </Link>
            ))}
          </nav>
        </div>
        <div className="right">
          <Bottle3D num={first.num} name={first.name} />
          <span className="footnote">{SPEC.bottle} · 即時 3D</span>
        </div>
      </section>

      <section id="s04" className="daily" aria-labelledby="daily-title">
        <div className="daily-top">
          <div>
            <span className="kicker">{HOME.s04.kicker}</span>
            <h2 id="daily-title" data-reveal>
              {HOME.s04.title[0]}
              <br />
              {HOME.s04.title[1]}
            </h2>
          </div>
          <Bottle3D num={third.num} name={third.name} className="stage3d" tilt={-0.5} scale={0.9} />
        </div>
        <Slot label="日常情境影像（D-E03）" className="slot daily-panel" />
      </section>

      <section id="s05" className="habits" aria-labelledby="habits-title">
        <div>
          <span className="kicker">{HOME.s05.kicker}</span>
          <h2 id="habits-title" data-reveal>
            {HOME.s05.title[0]}
            <br />
            {HOME.s05.title[1]}
          </h2>
        </div>
        <div className="scenes">
          {HOME.s05.scenes.map((s, i) => (
            <figure key={s} className="scene" style={{ margin: 0 }} data-reveal>
              <Slot label={`情境 0${i + 1} · ${s}`} />
              <figcaption className="cap">
                <b>0{i + 1}</b>
                {s}
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section id="s06" aria-label="讀懂自然">
        <Slot label="情境全幅影像（D-E03）" className="slot" style={{ minHeight: "38dvh", borderLeft: 0, borderRight: 0 }} />
        <Marquee />
        <div className="panel-dark">
          <span className="kicker">{HOME.s06.kicker}</span>
          <h2>
            {HOME.s06.title[0]}
            <br />
            {HOME.s06.title[1]}
          </h2>
          <div className="cta">
            <Link href="/products/" className="btn">
              {HOME.s06.cta} <span className="arrow">→</span>
            </Link>
            <Link href="/story/" className="btn light">
              {HOME.s06.cta2}
            </Link>
          </div>
        </div>
      </section>

      <SeriesCards />

      <section aria-labelledby="journal-title">
        <div className="jhead">
          <h2 id="journal-title">
            {JOURNAL.title}
            <span className="en">{JOURNAL.en}</span>
          </h2>
          <Link href="/journal/" className="textlink">
            全部文章 <span className="arrow">→</span>
          </Link>
        </div>
        <nav className="jtabs" aria-label="分類">
          {JOURNAL.categories.map((c, i) => (
            <Link key={c} href={i === 0 ? "/journal/" : `/journal/?cat=${encodeURIComponent(c)}`} aria-current={i === 0 ? "true" : undefined}>
              {c}
            </Link>
          ))}
        </nav>
        <JournalGrid />
      </section>

      <ContactBlocks />
    </>
  );
}
