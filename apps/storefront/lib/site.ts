// Site copy for the storefront rebuilt from DESIGN's prototype (Aki's screen recordings of
// 2026-10-13, accepted by Aki on 2026-10-14 as the complete design). Product names: Aki's decision
// of 2026-10-14 (日日順, 晶亮 kept; the third renamed 安和 per docs/product/naming-proposal.md because
// 「敏」 is banned by docs/compliance/claims.md). Function sentences only from claims.md §2.
// Facts (capsules, shelf life, price, SKU) from content/products/catalog.json.

export const BRAND = "Dr.Nature";
// Series name from content/products/catalog.json:5 (series.PB) until P2-01 approves another one
// (story.md:324 defers it to G2). 「Daily Flora 日常菌相系列」 had no approved source, and 菌相
// is a physiology hint at brand level (story.md:192).
export const SERIES = "益生菌系列";
export const LINE_ID = "@704vmtun"; // public LINE OA bot id (brand overview, redacted copy)

export type Product = {
  handle: string;
  num: "01" | "02" | "03";
  name: string; // 日日順益生菌
  short: string; // 日日順
  en: string;
  sku: string;
  tint: 1 | 2 | 3;
  /** The one function sentence allowed for this SKU (claims.md §2), or null when none is decided. */
  claim: string | null;
  claimNote: string;
  /** Status tag on the home 03 stage and the PDP. Internal-review wording only: no 法規審核 /
   * 審核中, which reads as an authority's pre-clearance (認定準則 第4條; regulatory.md:32). */
  pendingTag: string;
};

export const PRODUCTS: Product[] = [
  {
    handle: "daily",
    num: "01",
    name: "日日順益生菌",
    short: "日日順",
    en: "PROBIOTIC SERIES",
    sku: "DN-PB-01-060C",
    tint: 1,
    claim: "幫助消化，使排便順暢。",
    claimNote: "此句為食品標示及廣告法規允許的例句（claims.md §2）。",
    pendingTag: "說明文字複核中",
  },
  {
    handle: "clear",
    num: "02",
    name: "晶亮益生菌",
    short: "晶亮",
    en: "PROBIOTIC SERIES",
    sku: "DN-PB-02-060C",
    tint: 2,
    claim: null,
    claimNote: "這一款的說明，等配方路線與定位確認後再寫上。在那之前，先空著，不猜。",
    pendingTag: "說明文字待確認",
  },
  {
    handle: "calm",
    num: "03",
    name: "安和益生菌",
    short: "安和",
    en: "PROBIOTIC SERIES",
    sku: "DN-PB-03-060C",
    tint: 3,
    claim: "調整體質。產前產後或病後之補養。",
    claimNote: "此句為食品標示及廣告法規允許的例句（claims.md §2）。",
    pendingTag: "說明文字複核中",
  },
];

export const SPEC = { capsules: 60, shelfLifeYears: 2, price: 1150, priceText: "NT$ 1,150", bottle: "PB-100 · Ø45.8 × 85.7 mm" };

export const NAV = {
  primary: [
    { href: "/rd/", label: "研發" },
    { href: "/story/", label: "品牌故事" },
    { href: "/journal/", label: "知識誌" },
    { href: "/wholesale/", label: "團購合作" },
    { href: "/account/", label: "會員" },
  ],
  story: [
    { id: "s01", num: "01", label: "序" },
    { id: "s02", num: "02", label: "規矩" },
    { id: "s03", num: "03", label: "三個編號" },
    { id: "s04", num: "04", label: "日常" },
    { id: "s05", num: "05", label: "習慣" },
    { id: "s06", num: "06", label: "讀懂自然" },
  ],
  service: [
    { href: "/faq/", label: "常見問題" },
    { href: "/returns/", label: "退換貨政策" },
    { href: "/privacy/", label: "隱私權政策" },
    { href: "/terms/", label: "服務條款" },
  ],
};

export const HOME = {
  heroTitle: ["以科學，", "讀懂自然。"],
  heroEn: "Nature, read by science.",
  heroCta: "認識三款益生菌",
  heroMeta: ["01 日日順 · 02 晶亮 · 03 安和", "60 顆膠囊 · 效期 2 年 · NT$ 1,150"],
  // Verbatim from the recommended story, content/brand/story.md:148, split for the a / b1 /
  // inline image / b2 layout. The old line was removed: story.md:209 (不要 #6, no absolute
  // 「我們只說」 guarantee) and story.md:295 (row 25, no 「保健品」 put-down of the category).
  s02: { a: "Dr.Nature 說的每一句話，", b1: "都照一本筆記的", b2: "規矩寫。" },
  s03Kicker: "同一個瓶子，三個編號",
  s04: { kicker: "日常", title: ["放進你", "本來就有的習慣裡。"] },
  // Scene labels are times of day, not places: story.md:212 (不要 #9) and slogan.md:71 rule out
  // within-reach placement scenes until storage conditions (U-08) are known.
  s05: { kicker: "習慣", title: ["好的習慣，", "不需要提醒。"], scenes: ["早晨", "午後", "傍晚", "夜裡"] },
  s06: { marquee: ["Nature, read by science.", "以科學，讀懂自然。"], kicker: SERIES, title: ["說得剛好的", "一瓶益生菌。"], cta: "認識三款益生菌", cta2: "讀品牌故事" },
  seriesTitle: "三款，一個系列。",
  seriesLink: "全部產品",
};

export const JOURNAL = {
  title: "知識誌",
  en: "ARCHIVE",
  // Categories and sample titles use the brand-level vocabulary of content/brand/story.md:218
  // (標示、標籤、效期、有效日期、收單日) and its two audiences (story.md:158). No eye wording
  // (naming-proposal.md:28, 晶亮 condition), no 換季 (story.md:212,232), no organ names and no
  // SKU-C function words such as 體質 at brand level (story.md:192,204,221).
  categories: ["全部", "益生菌知識", "標示與標籤", "效期與保存", "家人與團購"],
  note: "撰寫中", // sample topics; every post is reviewed (claims-lint + 人工複核) before publishing
  posts: [
    { slug: "storage-after-opening", cat: "益生菌知識", title: "益生菌開封後，怎麼保存比較好？" },
    { slug: "read-the-label", cat: "益生菌知識", title: "挑選益生菌，先看包裝上的哪幾項標示" },
    // claims.md:36 (營養標示 for capsules: 每一份量＋每日參考值百分比)
    { slug: "nutrition-panel", cat: "標示與標籤", title: "營養標示怎麼讀：每一份量與每日參考值" },
    // story.md:197,218 (有效日期; 保存方式以標示為準)
    { slug: "expiry-date", cat: "效期與保存", title: "有效日期寫在哪裡？下單前先對照" },
    // story.md:158,200,250 (替朋友開團; 團購價寫明條件與收單日)
    { slug: "group-buy-checklist", cat: "家人與團購", title: "替朋友開團之前：規格、價格與收單日怎麼寫清楚" },
    { slug: "how-to-read-strain-names", cat: "益生菌知識", title: "菌株名稱怎麼讀？從一串英文字開始" },
  ],
};

// LINE promises follow G3 = ③ (Aki, 2026-10-15): the OA webhook is not live yet, so the block
// promises only launch and membership notices and says customer service is coming. No 訂單通知 or
// 補貨提醒 until DEV_PLAN marks LINE-14 done.
export const LINE_BLOCK = {
  title: "加入 LINE 好友",
  body: "正式開賣與會員開放時，會在這裡通知。LINE 客服即將開放。",
  newsletterTitle: "電子報",
  newsletterBody: "每月一封，只寄新文章與新品。",
};

export const FOOTER = {
  social: [
    { label: "Facebook", href: "https://www.facebook.com/share/1Js3iCU583/?mibextid=wwXIfr" },
    { label: "Instagram", href: null, note: "即將開放" }, // O-06: the brand overview link is wrong; waits for the corrected URL
    { label: `LINE ${LINE_ID}`, href: `https://line.me/R/ti/p/${LINE_ID}` },
  ],
  legal: "© 2026 Dr.Nature",
  company: "公司資訊：正式上線前公布", // O-10: company name, address and 食品業者登錄字號 not provided yet (U-07)
};

export const DISCLAIMER = ["本產品為一般食品，非藥品，不具醫療效能。", "本產品非健康食品，未經健康食品查驗登記。"];

export const NOTICE = "預覽版：部分內容與標示尚未定案，非正式銷售。";

export function product(handle: string): Product {
  const p = PRODUCTS.find((x) => x.handle === handle);
  if (!p) throw new Error(`unknown product ${handle}`);
  return p;
}
