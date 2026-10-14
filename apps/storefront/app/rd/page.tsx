import type { Metadata } from "next";
import { lines, page, rd, section } from "@/lib/content";

const p = page("rd");
export const metadata: Metadata = { title: "研發", description: p.meta_description };

// Only the verified degree, department and year (docs/research/cro.md); Aki confirmed on 2026-10-14
// the director agreed to be shown. No photo: the only one on file is a white-coat banner (claims.md:30).
export default function Rd() {
  const lead = section("rd", "rd-lead");
  const disclosure = section("rd", "disclosure");
  const body = lines(lead);
  return (
    <>
      <header className="page-head">
        <span className="kicker">研發</span>
        <h1 className="enter">研發長 鄭安生博士</h1>
      </header>
      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap two">
          <div className="rd-name" data-reveal>
            <span className="kicker plain">Dr.Nature 研發長 · Chief Research Officer</span>
            <span className="zh">{rd.name_zh}</span>
            <span className="en">{rd.name_en}</span>
            <dl>
              <dt>學位</dt>
              <dd>博士</dd>
              <dt>系所</dt>
              <dd>臺灣大學園藝暨景觀學系</dd>
              <dt>年份</dt>
              <dd>2013</dd>
            </dl>
          </div>
          <div className="prose">
            {body.map((l, i) => (
              <p key={l} className={i === 0 ? "lede" : undefined} data-reveal style={{ marginTop: i ? 14 : 0 }}>
                {l}
              </p>
            ))}
            <h2 data-reveal style={{ marginTop: 36, fontSize: "1.2rem" }}>
              {disclosure.heading}
            </h2>
            <p className="muted" data-reveal style={{ marginTop: 10 }}>
              {disclosure.body}
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
