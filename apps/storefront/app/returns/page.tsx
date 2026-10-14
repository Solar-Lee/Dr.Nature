import type { Metadata } from "next";

export const metadata: Metadata = { title: "退換貨政策" };

export default function Returns() {
  return (
    <>
      <header className="page-head">
        <h1 className="enter">退換貨政策</h1>
        <p className="lede enter" style={{ ["--i" as string]: 1 }}>
          本網站目前為預覽版，尚未開放購買，退換貨政策將於正式上線前公布。
        </p>
      </header>
      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap prose">
          <p className="muted">正式政策會載明：鑑賞期、食品類商品的退換條件、運費負擔、退款方式與聯絡窗口，並依消費者保護法與相關規定辦理。</p>
        </div>
      </section>
    </>
  );
}
