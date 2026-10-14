import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Bottle } from "../../components/Bottle";
import { bottleNumber, lines, page, products, section } from "@/lib/content";

type Params = { handle: string };

export const dynamicParams = false;

export function generateStaticParams(): Params[] {
  return products.map((p) => ({ handle: p.handle }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { handle } = await params;
  const p = page(`products/${handle}`);
  return { title: p.title, description: p.meta_description };
}

export default async function ProductPage({ params }: { params: Promise<Params> }) {
  const { handle } = await params;
  const idx = products.findIndex((p) => p.handle === handle);
  if (idx < 0) notFound();
  const pr = products[idx];
  const slug = `products/${handle}`;
  const intro = lines(section(slug, "intro"));
  const label = lines(section(slug, "label"));
  const pending = lines(section(slug, "pending"));
  const disclaimer = lines(section(slug, "disclaimer"));
  const num = bottleNumber(pr);
  const tint = (idx + 1) as 1 | 2 | 3;
  const others = products.filter((p) => p.handle !== handle);
  // intro body: line 1 = short spec line, line 2 = the one allowed sentence for this SKU (or the
  // "waiting" sentence for B); label body: line 1 = subline, then 品名：... rows.
  const claim = intro[1];
  const subline = label[0];
  const rows = label.slice(1).map((r) => {
    const [k, ...v] = r.split("：");
    return { k, v: v.join("：") };
  });

  return (
    <>
      <div className="pdp">
        <div className="stage" style={{ ["--tint" as string]: `var(--tint-${tint})` }}>
          <div className="light-sweep" aria-hidden="true" />
          <Bottle num={num} name="60 顆膠囊" tint={tint} width={230} dolly float />
          <span className="figure-note">瓶身示意，非實物</span>
        </div>

        <div className="pdp-info">
          <p className="kicker">No. {num}</p>
          <h1 className="enter">{pr.display_name}</h1>
          <p className="muted">{pr.short_line}</p>
          {claim ? <p className="claim">{claim}</p> : null}
          <p className="price">NT${pr.price_twd.toLocaleString("en-US")}</p>
          <div className="buy-row">
            <span className="btn" aria-disabled="true">
              即將開賣
            </span>
            <Link href="/faq/" className="textlink">
              現在可以購買嗎？
            </Link>
          </div>

          <div className="label-table" data-reveal>
            <h2>{subline}</h2>
            <dl>
              {rows.map((r) => (
                <div key={r.k} style={{ display: "contents" }}>
                  <dt>{r.k}</dt>
                  <dd>{r.v}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div data-reveal>
            <h3 style={{ marginBottom: 12 }}>待確認項目</h3>
            <ul className="pending">
              {pending.map((l) => (
                <li key={l}>{l.replace("：待確認", "")}</li>
              ))}
            </ul>
            <p className="muted" style={{ fontSize: 14, marginTop: 12 }}>
              資料確認後補上；在那之前不填推測值。
            </p>
          </div>

          <div className="disclaimer">
            {disclaimer.map((l) => (
              <p key={l}>{l}</p>
            ))}
          </div>

          <div className="others">
            {others.map((o) => (
              <Link key={o.handle} href={`/products/${o.handle}/`} className="btn ghost">
                {bottleNumber(o)} {o.display_name.replace("Dr.Nature ", "")} <span className="arrow">→</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
