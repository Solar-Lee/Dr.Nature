import type { Metadata } from "next";
import { LegalPage } from "../components/LegalPage";
import { page } from "@/lib/content";

const p = page("privacy");
export const metadata: Metadata = { title: p.title, description: p.meta_description };

export default function Privacy() {
  return <LegalPage slug="privacy" />;
}
