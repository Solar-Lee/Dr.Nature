import type { Metadata } from "next";
import Link from "next/link";
import { Bottle } from "../components/Bottle";
import { bottleNumber, lines, page, products, section } from "@/lib/content";

const p = page("products");
export const metadata: Metadata = { title: p.title, description: p.meta_description };

export default function Products() {
  const intro = section("products", "intro");
  const names = section("products", "names");
  const general = section("products", "general-food");
  const pending = section("products", "pending");
  const disclaimer = lines(section("products", "disclaimer"));
  return (
    <>
      <header className="page-head">
        <div className="wrap">
          <h1 className="enter">{intro.heading}</h1>
          <p className="lede enter" style={{ ["--i" as string]: 1 }}>
            {intro.body}
          </p>
          <p className="muted enter" style={{ ["--i" as string]: 2 }}>
            {names.body}
          </p>
        </div>
      </header>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap product-grid">
          {products.map((pr, i) => (
            <Link
              key={pr.handle}
              href={`/products/${pr.handle}/`}
              className="product-card"
              style={{ ["--tint" as string]: `var(--tint-${i + 1})`, ["--i" as string]: i }}
              data-reveal
            >
              <span className="num">{bottleNumber(pr)}</span>
              <div className="stage">
                <Bottle num={bottleNumber(pr)} name="60 顆膠囊" tint={(i + 1) as 1 | 2 | 3} width={i === 0 ? 170 : 120} />
              </div>
              <div>
                <h3>{pr.display_name}</h3>
                <p className="meta">{pr.short_line}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap series">
          <div className="prose">
            <h2 data-reveal>{general.heading}</h2>
            <p data-reveal style={{ marginTop: 16 }}>
              {general.body}
            </p>
          </div>
          <div className="prose">
            <h2 data-reveal>{pending.heading}</h2>
            <p data-reveal style={{ marginTop: 16 }}>
              {pending.body}
            </p>
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap disclaimer">
          {disclaimer.map((l) => (
            <p key={l}>{l}</p>
          ))}
        </div>
      </section>
    </>
  );
}
