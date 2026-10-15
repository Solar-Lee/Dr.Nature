import Link from "next/link";
import { Bottle } from "./Bottle";
import { MotionToggle } from "./MotionToggle";
import { DISCLAIMER, FOOTER, HOME, JOURNAL, LINE_BLOCK, LINE_ID, NAV, PRODUCTS, SPEC } from "@/lib/site";

export function Slot({ label, note = "影像製作中", className = "slot", style }: { label: string; note?: string; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={className} style={style} role="img" aria-label={`${label}（${note}）`}>
      <span>
        <span className="ico" />
        {label}
        <br />
        {note}
      </span>
    </div>
  );
}

export function Marquee() {
  const item = (
    <>
      <span>{HOME.s06.marquee[0]}</span>
      <span className="sq" aria-hidden="true" />
      <span className="zh">{HOME.s06.marquee[1]}</span>
      <span className="sq" aria-hidden="true" />
    </>
  );
  return (
    <div className="marquee">
      <p className="visually-hidden">{HOME.s06.marquee.join(" ")}</p>
      <div className="track" aria-hidden="true">
        {item}
        {item}
      </div>
    </div>
  );
}

/**
 * The card titles sit one level below the nearest heading: h3 on the home page (under the
 * section h2), h2 on /products/ where the page h1 is the series title (withHead=false).
 */
export function SeriesCards({ withHead = true, cardHeading = "h3" }: { withHead?: boolean; cardHeading?: "h2" | "h3" }) {
  const CardTitle = cardHeading;
  return (
    <section {...(withHead ? { "aria-labelledby": "series-title" } : { "aria-label": HOME.seriesTitle })}>
      {withHead && (
        <div className="series-head">
          <h2 id="series-title">{HOME.seriesTitle}</h2>
          <Link href="/products/" className="textlink">
            {HOME.seriesLink} <span className="arrow">→</span>
          </Link>
        </div>
      )}
      <div className="cards3">
        {PRODUCTS.map((p, i) => (
          <Link key={p.handle} href={`/products/${p.handle}/`} className="pcard" data-reveal style={{ ["--i" as string]: i }}>
            <div className="head">
              <span className="num">{p.num}</span>
              <span className="sku">{p.sku}</span>
            </div>
            <div className="stage" style={{ ["--tint" as string]: `var(--tint-${p.tint})` }}>
              <Bottle num={p.num} name={`${SPEC.capsules} 顆膠囊`} tint={p.tint} width={120} />
            </div>
            <div>
              <CardTitle>{p.name}</CardTitle>
              <p className="meta">
                {SPEC.capsules} 顆膠囊 · 效期 {SPEC.shelfLifeYears} 年 · {SPEC.priceText}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function JournalGrid({ posts = JOURNAL.posts, cat = JOURNAL.all }: { posts?: typeof JOURNAL.posts; cat?: string }) {
  const list = cat === JOURNAL.all ? posts : posts.filter((p) => p.cat === cat);
  return (
    <div className="jgrid">
      {list.map((p, i) => (
        <Link key={p.slug} href={`/journal/${p.slug}/`} className="jcard" data-reveal style={{ ["--i" as string]: i % 3 }}>
          <Slot label="文章主圖 1200×800" note="圖片製作中" />
          <span className="cat">{p.cat}</span>
          <h3>{p.title}</h3>
          <span className="note">{JOURNAL.note}</span>
        </Link>
      ))}
    </div>
  );
}

export function ContactBlocks() {
  return (
    <section className="contact" aria-label="聯絡與訂閱">
      <div>
        <h2>{LINE_BLOCK.title}</h2>
        <p className="muted">{LINE_BLOCK.body}</p>
        <div>
          <a className="btn" href={`https://line.me/R/ti/p/${LINE_ID}`} target="_blank" rel="noopener">
            <span aria-hidden="true">◯</span> {LINE_ID}
          </a>
        </div>
      </div>
      <div>
        <h2>{LINE_BLOCK.newsletterTitle}</h2>
        <p className="muted">{LINE_BLOCK.newsletterBody}</p>
        <form className="nl" action="/account/" method="get">
          <label htmlFor="nl-email" className="visually-hidden" style={{ position: "absolute", left: -9999 }}>
            Email
          </label>
          <input id="nl-email" className="input" type="email" placeholder="you@example.com" disabled aria-describedby="nl-hint" />
          <button type="button" disabled>
            訂閱
          </button>
          <span id="nl-hint" className="hint">
            電子報將於正式上線後開放訂閱。
          </span>
        </form>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="sitemap">
        <div>
          <Link href="/" className="wordmark" aria-label="Dr.Nature 首頁">
            Dr<span className="dot">.</span>Nature
          </Link>
          <div className="foot-motion">
            <MotionToggle />
          </div>
        </div>
        <div>
          <h2 className="foot-head">產品</h2>
          <ul>
            {PRODUCTS.map((p) => (
              <li key={p.handle}>
                <Link href={`/products/${p.handle}/`}>
                  {p.num} {p.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="foot-head">關於</h2>
          <ul>
            {NAV.primary.map((n) => (
              <li key={n.href}>
                <Link href={n.href}>{n.label}</Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="foot-head">服務</h2>
          <ul>
            {NAV.service.map((n) => (
              <li key={n.href}>
                <Link href={n.href}>{n.label}</Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="foot-head">社群</h2>
          <ul>
            {FOOTER.social.map((s) =>
              s.href ? (
                <li key={s.label}>
                  <a href={s.href} target="_blank" rel="noopener">
                    {s.label}
                  </a>
                </li>
              ) : (
                <li key={s.label} className="pending">
                  {s.label}（{s.note}）
                </li>
              ),
            )}
          </ul>
        </div>
      </div>
      <div className="legal">
        <div className="disclaimer-row">
          {DISCLAIMER.map((l) => (
            <p key={l}>{l}</p>
          ))}
        </div>
        <span>{FOOTER.legal}</span>
        <span>{FOOTER.company}</span>
      </div>
    </footer>
  );
}
