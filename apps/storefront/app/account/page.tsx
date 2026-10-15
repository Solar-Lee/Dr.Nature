import type { Metadata } from "next";
import Link from "next/link";
import { LINE_ID } from "@/lib/site";

export const metadata: Metadata = { title: "會員", description: "Dr.Nature 會員中心：訂單、等級與權益。正式上線後開放。", alternates: { canonical: "/account/" } };

// The cart box on every page and the 會員 nav item land here. Until checkout and membership ship,
// the honest next steps are the LINE OA (launch notice only; G3 = ③, webhook not live yet, so no
// order or restock promises) and the product pages.
const AT_LAUNCH = ["會員登入", "訂單與物流狀態", "發票", "等級與權益"];

export default function Account() {
  return (
    <>
      <header className="page-head">
        <h1 className="enter">會員</h1>
        <p className="lede enter" style={{ ["--i" as string]: 1 }}>
          登入、訂單、物流狀態、發票、等級與權益，都在這裡。
        </p>
      </header>
      <section className="section" style={{ paddingTop: 0 }}>
        <div className="soon">
          <h2 style={{ fontSize: "1.3rem" }}>正式上線時開放</h2>
          <ul>
            {AT_LAUNCH.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <p className="muted">會員功能與購物車將於正式上線時開放。現在可以先加入 LINE 好友，開賣與會員開放時會通知你。</p>
          <div className="buy-row">
            <a className="btn" href={`https://line.me/R/ti/p/${LINE_ID}`} target="_blank" rel="noopener">
              加入 LINE，開賣與會員開放時通知
            </a>
            <Link href="/products/" className="btn ghost">
              先看三款產品
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
