import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "找不到這一頁" };

export default function NotFound() {
  return (
    <header className="page-head">
      <div className="wrap">
        <h1>找不到這一頁</h1>
        <p className="lede">這個網址在預覽版裡沒有內容。</p>
        <p>
          <Link href="/" className="btn ghost">
            回首頁 <span className="arrow">→</span>
          </Link>
        </p>
      </div>
    </header>
  );
}
