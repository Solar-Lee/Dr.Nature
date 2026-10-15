import type { Metadata } from "next";
import "./globals.css";
import { RevealOnScroll } from "./reveal";
import { SideNav, TopBar } from "./components/Nav";
import { Footer } from "./components/Blocks";
import { NOTICE } from "@/lib/site";

// Canonical URLs (UX-14): pages set alternates.canonical as a path; metadataBase makes it absolute.
// NEXT_PUBLIC_BASE_URL is whitelisted in docs/ENV.md (default = the production storefront).
export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_BASE_URL || "https://dr.nature.smilelife.tw"),
  title: { default: "Dr.Nature｜以科學，讀懂自然。", template: "%s｜Dr.Nature" },
  description: "Dr.Nature Daily Flora 日常菌相系列：三款益生菌，同一個瓶子，三個編號。60 顆膠囊，效期 2 年。",
  robots: { index: false, follow: false, nocache: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant-TW">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        <a className="skip" href="#main">
          跳到主要內容
        </a>
        <aside className="notice" aria-label="預覽版提示">
          {NOTICE}
        </aside>
        <TopBar />
        <div className="shell">
          <SideNav />
          <div className="page">
            <main id="main">{children}</main>
            <Footer />
          </div>
        </div>
        <RevealOnScroll />
      </body>
    </html>
  );
}
