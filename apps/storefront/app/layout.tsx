import type { Metadata } from "next";
import "./globals.css";
import { RevealOnScroll } from "./reveal";
import { SideNav, TopBar } from "./components/Nav";
import { Footer } from "./components/Blocks";
import { NOTICE } from "@/lib/site";

export const metadata: Metadata = {
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
        <div className="notice" role="note">
          {NOTICE}
        </div>
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
