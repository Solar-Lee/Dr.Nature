"use client";

// Sections 01–03 of the home story that need a shared 3D bottle handle (the stage in 03 is pinned
// and its label cycles with the scroll). Server-renders the same markup; ScrollFX attaches later.
import Link from "next/link";
import { useMemo, useRef } from "react";
import { Bottle3D, type Bottle3DHandle } from "./Bottle3D";
import { Greeting } from "./Greeting";
import { ScrollFX } from "./ScrollFX";
import { HOME, PRODUCTS, SERIES, SPEC } from "@/lib/site";

const STAIRS = 8;

export function HomeStory() {
  const bottle = useRef<Bottle3DHandle>(null);
  const first = PRODUCTS[0];
  const steps = useMemo(() => PRODUCTS.map((p) => ({ num: p.num, name: p.name })), []);
  return (
    <>
      {/* 01 + 02 share a wrapper: under the choreography the hero is sticky inside it, so it stays
          put exactly while 02 passes over it (globals.css, motion block). */}
      <div className="stick">
        <section id="s01" className="hero" aria-labelledby="hero-title">
          <div className="hero-top">
            <div className="hero-copy">
              <div className="enter" style={{ ["--i" as string]: 0 }}>
                <Greeting />
              </div>
              <h1 id="hero-title" className="enter" style={{ ["--i" as string]: 1 }}>
                {HOME.heroTitle[0]}
                <br />
                {HOME.heroTitle[1]}
              </h1>
              <div className="hero-cta enter" style={{ ["--i" as string]: 2 }}>
                <Link href="/products/" className="btn">
                  {HOME.heroCta} <span className="arrow">→</span>
                </Link>
                <span className="en">{HOME.heroEn}</span>
              </div>
            </div>
            <div className="hero-meta enter" style={{ ["--i" as string]: 3 }}>
              <b>{SERIES}</b>
              {HOME.heroMeta.map((l) => (
                <span key={l} style={{ display: "block" }}>
                  {l}
                </span>
              ))}
            </div>
          </div>
          <div className="hero-stage">
            <div className="hero-video" aria-hidden="true">
              <span className="tag">品牌影片（D-E01）製作中</span>
            </div>
            <Bottle3D num={first.num} name={first.name} className="stage3d" tilt={0.14} scale={1.05} />
          </div>
          <p className="giant" aria-hidden="true">
            Dr<span className="dot">.</span>Nature
          </p>
        </section>

        <section id="s02" className="dark" aria-label="我們只說">
          <div className="stairs" aria-hidden="true">
            {Array.from({ length: STAIRS }, (_, i) => (
              <span key={i} />
            ))}
          </div>
          <h2>
            {HOME.s02.a}
            <br />
            {HOME.s02.b1}
            <span className="inline-slot" aria-hidden="true" />
            <span className="dim">{HOME.s02.b2}</span>
          </h2>
        </section>
      </div>

      <section id="s03" aria-label="三個編號">
        <div className="three">
          <div className="left">
            <span className="kicker">{HOME.s03Kicker}</span>
            <div className="numstack">
              {PRODUCTS.map((p, i) => (
                <div key={p.handle} className="numstep" data-step={i} data-active={i === 0 ? "" : undefined}>
                  <div className="bignum">{p.num}</div>
                  <div className="pname">{p.name}</div>
                  <span className="ptag">{p.pendingTag}</span>
                </div>
              ))}
            </div>
            <nav className="tabs" aria-label="三款">
              {PRODUCTS.map((p, i) => (
                <Link key={p.handle} href={`/products/${p.handle}/`} aria-current={i === 0 ? "true" : undefined}>
                  {p.num} {p.short}
                </Link>
              ))}
            </nav>
          </div>
          <div className="right">
            <Bottle3D ref={bottle} num={first.num} name={first.name} />
            <span className="footnote">{SPEC.bottle} · 即時 3D · 隨捲動轉動</span>
          </div>
        </div>
      </section>
      <ScrollFX bottle={bottle} steps={steps} />
    </>
  );
}
