import type { Metadata } from "next";
import { LegalPage } from "../components/LegalPage";
import { page } from "@/lib/content";

const p = page("privacy");
// preview-copy.json titles already end in 「｜Dr.Nature」; the root title.template adds it again.
export const metadata: Metadata = { title: p.title.replace(/｜Dr\.Nature$/, ""), description: p.meta_description };

export default function Privacy() {
  return <LegalPage slug="privacy" />;
}
