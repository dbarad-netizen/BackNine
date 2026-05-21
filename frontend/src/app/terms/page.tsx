import type { Metadata } from "next";
import LegalDoc from "@/components/LegalDoc";
import { LEGAL_DOCS } from "@/lib/legalContent";

export const metadata: Metadata = { title: "Terms of Use · BackNine" };

export default function TermsPage() {
  const doc = LEGAL_DOCS.terms;
  return <LegalDoc title={doc.title} body={doc.body} />;
}
