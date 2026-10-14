import type { Metadata } from "next";
import { SeriesCards } from "../components/Blocks";
import { DISCLAIMER, HOME, SERIES, SPEC } from "@/lib/site";

export const metadata: Metadata = { title: "產品", description: `${SERIES}：三款益生菌，每瓶 ${SPEC.capsules} 顆膠囊，效期 ${SPEC.shelfLifeYears} 年，官網售價 ${SPEC.priceText}。` };

export default function Products() {
  return (
    <>
      <header className="page-head">
        <span className="kicker">{SERIES}</span>
        <h1 className="enter">{HOME.seriesTitle}</h1>
        <p className="lede enter" style={{ ["--i" as string]: 1 }}>
          同一個瓶子，三個編號。每瓶 {SPEC.capsules} 顆膠囊，效期 {SPEC.shelfLifeYears} 年，官網售價 {SPEC.priceText}。三款都是一般食品，不是藥品。每一款的說明，寫在它自己的頁面上，一款一頁，不加形容詞。
        </p>
      </header>
      <SeriesCards withHead={false} />
      <section className="section">
        <div className="wrap two">
          <div className="prose">
            <h2>還沒確認的，先空著</h2>
            <p style={{ marginTop: 14 }}>菌種名稱、每顆含菌數、建議食用量、原產地與製造廠等標示項目，資料確認後才補上。在那之前，標示表上寫「待確認」，不先填入推測值。</p>
          </div>
          <div className="disclaimer" style={{ borderTop: 0, paddingTop: 0 }}>
            {DISCLAIMER.map((l) => (
              <p key={l}>{l}</p>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
