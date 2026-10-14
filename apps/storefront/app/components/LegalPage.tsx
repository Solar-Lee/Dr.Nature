import { lines, page } from "@/lib/content";

/** Privacy and terms: heading of the first section is the page title, the rest are h2 + text. */
export function LegalPage({ slug }: { slug: string }) {
  const p = page(slug);
  const secs = Object.values(p.sections);
  const [first, ...rest] = secs;
  return (
    <>
      <header className="page-head">
        <div className="wrap">
          <h1 className="enter">{first.heading}</h1>
          <p className="lede enter" style={{ ["--i" as string]: 1 }}>
            {first.body}
          </p>
        </div>
      </header>
      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap prose">
          {rest.map((s) => (
            <div key={s.heading} data-reveal style={{ marginBottom: 32 }}>
              <h2 style={{ fontSize: "1.2rem", marginBottom: 10 }}>{s.heading}</h2>
              {lines(s).map((l) => (
                <p key={l} className="muted">
                  {l}
                </p>
              ))}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
