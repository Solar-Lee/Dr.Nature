import type { Metadata } from "next";
import { FaqHash } from "../components/FaqHash";
import { faq, page, section } from "@/lib/content";

const p = page("faq");

// Stable anchors other pages link to (PDP buy row, /returns/). Every other item is faq-<n>.
// A renamed question must fail the build instead of silently breaking /faq/#buy.
const ANCHOR: Record<string, string> = { "現在可以購買嗎？": "buy", "三款有什麼不同？": "differences" };
for (const q of Object.keys(ANCHOR)) {
  if (!faq.some((f) => f.q === q)) throw new Error(`faq anchor: no question 「${q}」 in preview-copy.json`);
}
// preview-copy.json titles already end in 「｜Dr.Nature」; the root title.template adds it again.
export const metadata: Metadata = { title: p.title.replace(/｜Dr\.Nature$/, ""), description: p.meta_description, alternates: { canonical: "/faq/" } };

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
              <details key={f.q} id={ANCHOR[f.q] ?? `faq-${i + 1}`} open={i === 0}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
          <FaqHash />
        </div>
      </section>
    </>
  );
}
