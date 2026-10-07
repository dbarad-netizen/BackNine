"use client";

/**
 * CoffeeLedgerCard — the Coffee Tab (David 2026-10-07).
 *
 * "Lowest score buys coffee. That's David." is a joke in the Sunday text
 * until there's a ledger. This is the ledger: one row per week (loser →
 * winner), a running count of coffees still owed, and a Settled button.
 * It's the first thing in the app that exists only because of the text —
 * stakes the text names, the app keeps. Self-hides until the first
 * recorded week.
 */

import { useEffect, useState } from "react";
import { api, type CoffeeLedger } from "@/lib/api";

export default function CoffeeLedgerCard() {
  const [data, setData] = useState<CoffeeLedger | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const load = () => api.coffee().then(setData).catch(() => setData(null));
  useEffect(() => { load(); }, []);

  if (!data || data.weeks.length === 0) return null;

  const settle = async (id: number) => {
    setBusy(id);
    try { await api.settleCoffee(id); await load(); } finally { setBusy(null); }
  };

  const fmtWeek = (iso: string) =>
    new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return (
    <section className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 flex items-center justify-between bg-[#1B3829]/5 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <span className="text-xl leading-none">☕</span>
          <div>
            <p className="font-bold text-sm text-[#1B3829] leading-tight">The Coffee Tab</p>
            <p className="text-[10px] uppercase tracking-widest text-gray-500">lowest score of the week buys</p>
          </div>
        </div>
        {data.owed.length > 0 ? (
          <div className="text-right">
            {data.owed.map(o => (
              <p key={o.user_id} className="text-[11px] text-gray-700">
                <span className="font-semibold">{o.name}</span> owes {o.count}
              </p>
            ))}
          </div>
        ) : (
          <span className="text-[11px] text-emerald-700 font-semibold">All square</span>
        )}
      </div>

      <div className="divide-y divide-gray-50">
        {data.weeks.slice(0, 8).map(w => (
          <div key={w.id} className="flex items-center gap-3 px-4 py-2.5">
            <span className="w-14 shrink-0 text-[11px] text-gray-500">Week of {fmtWeek(w.week_start)}</span>
            <span className="flex-1 text-sm text-gray-800 min-w-0 truncate">
              <span className="font-semibold">{w.loser.name}</span>
              {w.loser.score != null && <span className="text-gray-500"> ({w.loser.score})</span>}
              {" "}buys{" "}
              <span className="font-semibold">{w.winner.name}</span>
              {w.winner.score != null && <span className="text-gray-500"> ({w.winner.score})</span>}
            </span>
            {w.settled_at ? (
              <span className="text-[11px] text-emerald-700 font-semibold shrink-0">✓ Settled</span>
            ) : (
              <button
                onClick={() => settle(w.id)}
                disabled={busy === w.id}
                className="shrink-0 text-[11px] font-semibold text-[#1B3829] border border-[#1B3829]/30 rounded-lg px-2.5 py-1 hover:bg-[#1B3829]/5 disabled:opacity-50"
              >
                {busy === w.id ? "…" : "Settled"}
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
