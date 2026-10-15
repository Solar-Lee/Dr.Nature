import type { Metadata } from "next";
import Link from "next/link";
import { Bottle3D } from "./components/Bottle3D";
import { HomeStory } from "./components/HomeStory";
import { ContactBlocks, JournalGrid, Marquee, SeriesCards, Slot } from "./components/Blocks";
import { HOME, JOURNAL, PRODUCTS } from "@/lib/site";

export const metadata: Metadata = { alternates: { canonical: "/" } };

// Home: the six-part story from DESIGN's prototype (01 序 … 06 讀懂自然), then the series cards,
// 知識誌, LINE / 電子報. Section ids match NAV.story so the left index tracks the scroll.
export default function Home() {
  const third = PRODUCTS[2];
  return (
    <>
      <HomeStory />

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
        <Slot label="日常情境影像" className="slot daily-panel" />
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
        <div className="scenes" tabIndex={0} role="region" aria-label="習慣情境">
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
        <div className="wide">
          <Slot label="情境全幅影像" className="slot" style={{ minHeight: "38dvh", borderLeft: 0, borderRight: 0 }} />
        </div>
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
