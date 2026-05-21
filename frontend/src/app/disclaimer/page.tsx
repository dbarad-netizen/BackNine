import type { Metadata } from "next";
import LegalDoc from "@/components/LegalDoc";
import { LEGAL_DOCS } from "@/lib/legalContent";

export const metadata: Metadata = { title: "Medical & Health Disclaimer · BackNine" };

export default function DisclaimerPage() {
  const doc = LEGAL_DOCS.disclaimer;
  return <LegalDoc title={doc.title} body={doc.body} />;
}
