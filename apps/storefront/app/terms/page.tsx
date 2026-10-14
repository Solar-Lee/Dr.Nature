import type { Metadata } from "next";
import { LegalPage } from "../components/LegalPage";
import { page } from "@/lib/content";

const p = page("terms");
export const metadata: Metadata = { title: p.title, description: p.meta_description };

export default function Terms() {
  return <LegalPage slug="terms" />;
}
