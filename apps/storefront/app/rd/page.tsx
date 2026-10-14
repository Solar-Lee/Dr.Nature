import type { Metadata } from "next";
import { lines, page, rd, section } from "@/lib/content";

const p = page("rd");
export const metadata: Metadata = { title: p.title, description: p.meta_description };

// 〔需 U-12 同意〕 Aki confirmed on 2026-10-14 that the director agreed to be shown to the client.
// Only verified degree, department and year (docs/research/cro.md). No photo: the only photo on
// file is a white-coat banner (claims.md:30). Slogan is kept off this page (slogan.md 三).
export default function Rd() {
  const lead = section("rd", "rd-lead");
  const disclosure = section("rd", "disclosure");
  const body = lines(lead);
  return (
    <>
      <header className="page-head">
        <div className="wrap">
          <h1 className="enter">{lead.heading}</h1>
        </div>
      </header>
      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap rd">
          <div className="rd-name" data-reveal>
            <span className="kicker">Dr.Nature 研發長</span>
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
              <p key={l} className={i === 0 ? "lede" : undefined} data-reveal style={{ marginTop: i ? 16 : 0 }}>
                {l}
              </p>
            ))}
            <h2 data-reveal style={{ marginTop: 40, fontSize: "1.2rem" }}>
              {disclosure.heading}
            </h2>
            <p className="muted" data-reveal style={{ marginTop: 12 }}>
              {disclosure.body}
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
