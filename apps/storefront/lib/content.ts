// Typed access to content/preview-copy.json. Every string shown on the site comes from that file,
// which keeps the source (repo file:line) of each section; see its $comment.
import copy from "../content/preview-copy.json";

export type Section = { heading: string; body: string; sources: string[] };
export type Page = { title: string; meta_description: string; sections: Record<string, Section> };
export type Product = {
  handle: string;
  display_name: string;
  sku: string;
  price_twd: number;
  capsules?: number;
  short_line: string;
  description: string;
  spec_rows: { label: string; value: string }[];
  pending_items: string[];
  sources: string[];
};
export type Faq = { q: string; a: string; sources: string[] };

type Copy = {
  slogan: string;
  slogan_en: string;
  pages: Record<string, Page>;
  products: Product[];
  faq: Faq[];
  rd: { name_zh: string; name_en: string };
};

const c = copy as unknown as Copy;

export const slogan = c.slogan;
export const sloganEn = c.slogan_en;
export const site = c.pages._site;
export const products = c.products;
export const faq = c.faq;
export const rd = c.rd;

export function page(slug: string): Page {
  const p = c.pages[slug];
  if (!p) throw new Error(`preview-copy.json has no page "${slug}"`);
  return p;
}

export function section(slug: string, id: string): Section {
  const s = page(slug).sections[id];
  if (!s) throw new Error(`preview-copy.json page "${slug}" has no section "${id}"`);
  return s;
}

/** Lines of a section body (the JSON joins lines with \n). */
export function lines(s: Section): string[] {
  return s.body.split("\n").map((l) => l.trim()).filter(Boolean);
}

/** Bottle number shown on the label: SKU DN-PB-01 -> "01". */
export function bottleNumber(p: Product): string {
  const m = /DN-PB-(\d\d)/.exec(p.sku);
  return m ? m[1] : "00";
}

export const NAV = [
  { href: "/", label: "首頁" },
  { href: "/story/", label: "品牌故事" },
  { href: "/products/", label: "產品" },
  { href: "/rd/", label: "研發長" },
  { href: "/faq/", label: "常見問題" },
] as const;

export const LEGAL = [
  { href: "/privacy/", label: "隱私說明" },
  { href: "/terms/", label: "使用條款" },
] as const;
