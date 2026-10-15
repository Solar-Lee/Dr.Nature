import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Bottle3D } from "../../components/Bottle3D";
import { Breadcrumb } from "../../components/Breadcrumb";
import { DISCLAIMER, LINE_ID, PRODUCTS, SERIES, SPEC } from "@/lib/site";

type Params = { handle: string };
export const dynamicParams = false;
export function generateStaticParams(): Params[] {
  return PRODUCTS.map((p) => ({ handle: p.handle }));
}
export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { handle } = await params;
  const p = PRODUCTS.find((x) => x.handle === handle);
  return {
    title: p ? `${p.num} ${p.name}` : "產品",
    description: p ? `${p.name}，${SPEC.capsules} 顆膠囊，效期 ${SPEC.shelfLifeYears} 年，官網售價 ${SPEC.priceText}。` : undefined,
    alternates: p ? { canonical: `/products/${p.handle}/` } : undefined,
  };
}

const PENDING = ["菌種名稱（中英文）", "菌株編號", "每顆含菌數", "建議食用量", "保存方式", "內容物與食品添加物", "營養標示", "素食標示", "原產地", "製造廠", "其他法定標示項目", "國際條碼（EAN-13）"];

export default async function ProductPage({ params }: { params: Promise<Params> }) {
  const { handle } = await params;
  const p = PRODUCTS.find((x) => x.handle === handle);
  if (!p) notFound();
  const others = PRODUCTS.filter((x) => x.handle !== handle);
  return (
    <div className="pdp">
      <div className="stage" style={{ ["--tint" as string]: `var(--tint-${p.tint})` }}>
        <Bottle3D num={p.num} name={p.name} />
        <span className="footnote">{SPEC.bottle} · 即時 3D · 拖曳可旋轉</span>
      </div>
      <div className="pdp-info">
        <Breadcrumb
          items={[
            { href: "/", label: "首頁" },
            { href: "/products/", label: "產品" },
            { label: `${p.num} ${p.name}` },
          ]}
        />
        <span className="kicker">
          {SERIES} · No. {p.num}
        </span>
        <h1 className="enter">{p.name}</h1>
        <p className="muted">
          {SPEC.capsules} 顆膠囊 · 效期 {SPEC.shelfLifeYears} 年 · 官網售價 {SPEC.priceText}
        </p>
        {p.claim ? <p className="claim">{p.claim}</p> : <p className="muted">{p.claimNote}</p>}
        <span className="ptag">{p.pendingTag}</span>
        <p className="price">{SPEC.priceText}</p>
        <div className="buy-row">
          <span className="btn" aria-disabled="true">
            即將開賣
          </span>
          <a className="btn ghost" href={`https://line.me/R/ti/p/${LINE_ID}`} target="_blank" rel="noopener">
            開賣時用 LINE 通知我
          </a>
        </div>
        <div className="buy-row">
          <Link href="/faq/#buy" className="textlink">
            現在可以購買嗎？
          </Link>
          <Link href="/faq/#differences" className="textlink">
            三款有什麼不同？
          </Link>
        </div>
        <div className="label-table" data-reveal>
          <h2>先讀標籤，再決定。</h2>
          <dl>
            <dt>品名</dt>
            <dd>{p.name}</dd>
            <dt>系列</dt>
            <dd>{SERIES}</dd>
            <dt>SKU</dt>
            <dd className="num">{p.sku}</dd>
            <dt>內容量</dt>
            <dd>{SPEC.capsules} 顆膠囊</dd>
            <dt>效期</dt>
            <dd>{SPEC.shelfLifeYears * 12} 個月</dd>
            <dt>官網售價</dt>
            <dd>{SPEC.priceText}</dd>
          </dl>
        </div>
        <div data-reveal>
          <h3 style={{ marginBottom: 10 }}>待確認項目</h3>
          <ul className="pending-list">
            {PENDING.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
            資料確認後補上；在那之前不填推測值。
          </p>
        </div>
        <div className="disclaimer">
          {DISCLAIMER.map((l) => (
            <p key={l}>{l}</p>
          ))}
        </div>
        <div className="others">
          {others.map((o) => (
            <Link key={o.handle} href={`/products/${o.handle}/`} className="btn ghost">
              {o.num} {o.name} <span className="arrow">→</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
