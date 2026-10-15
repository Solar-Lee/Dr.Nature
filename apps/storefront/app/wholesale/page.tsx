import type { Metadata } from "next";
import { LINE_ID } from "@/lib/site";

export const metadata: Metadata = { title: "團購合作", description: "Dr.Nature 團購合作：照原話轉述就夠了，合作內容開頭標示「合作」或「廣告」。", alternates: { canonical: "/wholesale/" } };

export default function Wholesale() {
  return (
    <>
      <header className="page-head">
        <h1 className="enter">團購合作</h1>
        <p className="lede enter" style={{ ["--i" as string]: 1 }}>
          這些話，寫給替家人挑選的人，也寫給替朋友開團的人。轉述的時候，照原話說就夠了，不必多加一句。
        </p>
      </header>
      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap two">
          <div className="prose">
            <h2>怎麼合作</h2>
            <p style={{ marginTop: 14 }}>團購價要寫明條件與收單日，並加註「本團價格與組合，以團購頁公告為準」。團購、KOL、團主貼文等合作內容，開頭標示「合作」或「廣告」。</p>
            <p>合作素材只提供已查證的事實：60 顆膠囊、效期 2 年、官網售價 NT$ 1,150，以及各款頁面上的說明。</p>
          </div>
          <div className="soon">
            <h2 style={{ fontSize: "1.3rem" }}>申請合作</h2>
            <p className="muted">團購申請表單與分潤後台正式上線後開放。現在可以先透過 LINE 聯絡我們。</p>
            <div>
              <a className="btn" href={`https://line.me/R/ti/p/${LINE_ID}`} target="_blank" rel="noopener">
                LINE {LINE_ID}
              </a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
