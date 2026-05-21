import type { Metadata } from "next";
import LegalDoc from "@/components/LegalDoc";
import { LEGAL_DOCS } from "@/lib/legalContent";

export const metadata: Metadata = { title: "Privacy Policy · BackNine" };

export default function PrivacyPage() {
  const doc = LEGAL_DOCS.privacy;
  return <LegalDoc title={doc.title} body={doc.body} />;
}
