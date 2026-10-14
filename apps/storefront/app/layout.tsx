import type { Metadata } from "next";
import "./globals.css";
import { RevealOnScroll } from "./reveal";
import { SideNav, TopBar } from "./components/Nav";
import { Footer } from "./components/Footer";
import { site } from "@/lib/content";

export const metadata: Metadata = {
  title: { default: site.title, template: "%s" },
  description: site.meta_description,
  // Preview: never indexed (nginx also sends X-Robots-Tag).
  robots: { index: false, follow: false, nocache: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant-TW">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Google Fonts serves Noto Sans TC in unicode-range slices, so only the used CJK ranges download. */}
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <a className="skip" href="#main">
          跳到主要內容
        </a>
        <div className="notice" role="note">
          {site.sections.notice.body}
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
