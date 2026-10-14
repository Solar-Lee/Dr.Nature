import type { Metadata } from "next";
import { faq, page, section } from "@/lib/content";

const p = page("faq");
export const metadata: Metadata = { title: p.title, description: p.meta_description };

export default function Faq() {
  const intro = section("faq", "intro");
  return (
    <>
      <header className="page-head">
        <div className="wrap">
          <h1 className="enter">{intro.heading}</h1>
          <p className="lede enter" style={{ ["--i" as string]: 1 }}>
            {intro.body.replace(/（問答內容見.*）/, "")}
          </p>
        </div>
      </header>
      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="faq">
            {faq.map((f, i) => (
              <details key={f.q} open={i === 0}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
