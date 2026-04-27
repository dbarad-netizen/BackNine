import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function scoreColor(score: number | null | undefined): string {
  if (score == null) return "text-zinc-500";
  if (score >= 85)   return "text-green-400";
  if (score >= 70)   return "text-yellow-400";
  return "text-red-400";
}

export function scoreBg(score: number | null | undefined): string {
  if (score == null) return "border-zinc-700";
  if (score >= 85)   return "border-green-500";
  if (score >= 70)   return "border-yellow-500";
  return "border-red-500";
}

export function fmtDate(iso: string): string {
  // Date-only strings (YYYY-MM-DD) are parsed as UTC midnight by the JS Date
  // constructor, which shifts them back one day in timezones behind UTC (e.g.
  // ET after 8 PM). Append T12:00:00 to anchor to local noon instead.
  const safe = iso.length === 10 ? iso + "T12:00:00" : iso;
  return new Date(safe).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function fmtHrs(secs: number | null | undefined): string {
  if (secs == null) return "—";
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
