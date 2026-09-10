import Link from "next/link";
import type { Metadata } from "next";

/**
 * /qyl — the QYL Index landing page (David + Chris, 2026-09-10).
 *
 * The "second front door" experiment: a standalone pitch for the QYL
 * Index metric that funnels into BackNine. When qylindex.com is
 * purchased it points here (add the domain in Vercel → Domains and
 * assign this route or a redirect). If strangers convert through this
 * door at meaningful rates, that's the market voting on Chris's name
 * — evidence for or against the full rebrand, gathered cheaply.
 *
 * Server component, no client JS — loads instantly, SEO-friendly.
 */

export const metadata: Metadata = {
  title: "QYL Index — how many quality years do you have left?",
  description:
    "The QYL Index projects your quality years left — active, independent years — from actuarial life tables evaluated at your biological age, not your birthday age. Free with BackNine.",
};

export default function QylLandingPage() {
  return (
    <main className="bg-[#0f1a15] text-zinc-100 min-h-screen">
      {/* Nav */}
      <nav className="border-b border-zinc-800/60 sticky top-0 z-30 bg-[#0f1a15]/95 backdrop-blur">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <span className="text-lg font-bold tracking-tight">
            <span className="text-green-400">QYL</span>
            <span className="text-white"> Index</span>
          </span>
          <Link
            href="/signin"
            className="rounded-lg bg-green-500 hover:bg-green-400 text-black font-semibold px-4 py-1.5 text-sm transition-colors"
          >
            Get your QYL
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-3xl mx-auto px-4 sm:px-6 pt-16 pb-12 text-center">
        <h1 className="text-4xl sm:text-5xl font-bold leading-tight">
          How many <span className="text-green-400">quality years</span> do
          you have left?
        </h1>
        <p className="mt-5 text-zinc-400 text-lg max-w-xl mx-auto leading-relaxed">
          Not lifespan — <span className="text-zinc-200">healthspan</span>.
          The QYL Index projects your active, independent years ahead, and
          shows you exactly which habits are buying more of them.
        </p>
        <Link
          href="/signin"
          className="inline-block mt-8 rounded-xl bg-green-500 hover:bg-green-400 text-black font-bold px-8 py-3.5 text-lg transition-colors"
        >
          Get your QYL Index — free
        </Link>
        <p className="mt-3 text-zinc-600 text-xs">
          Works with Oura Ring and Apple Health · 2 minutes to your first number
        </p>
      </section>

      {/* Example card */}
      <section className="max-w-md mx-auto px-4 pb-14">
        <div className="rounded-2xl border border-green-900/60 bg-[#13241c] p-6">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
              ⛳ Quality years left
              <span className="ml-2 normal-case tracking-normal text-[10px] font-bold text-green-300 bg-green-900/50 rounded px-1.5 py-0.5">
                QYL Index
              </span>
            </p>
            <span className="text-[11px] text-zinc-500">likely 12–22</span>
          </div>
          <div className="mt-3 flex items-baseline gap-3">
            <span className="text-6xl font-bold text-green-400 leading-none">~17</span>
            <div>
              <p className="text-sm font-semibold text-zinc-100">
                quality years projected
              </p>
              <p className="text-xs text-zinc-400 mt-0.5">
                biological age is buying <span className="text-green-300 font-semibold">+1.2</span> of them
              </p>
            </div>
          </div>
          <p className="mt-4 text-xs text-zinc-500 border-t border-zinc-800 pt-3">
            A real member&apos;s card. The number moves when the habits move.
          </p>
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-3xl mx-auto px-4 sm:px-6 pb-14">
        <h2 className="text-2xl font-bold text-center mb-8">How the QYL Index works</h2>
        <div className="grid sm:grid-cols-3 gap-4">
          {[
            {
              n: "1",
              t: "Your biological age",
              d: "Ten markers from your wearable and labs — HRV, VO₂ max, blood pressure, lipids, kidney function — scored against what's typical for your age. Every marker's contribution is shown. No black box.",
            },
            {
              n: "2",
              t: "Actuarial honesty",
              d: "Standard life tables give the years ahead for your age and sex, scaled to the share lived active and independent. Evaluated at your biological age — not your birthday age.",
            },
            {
              n: "3",
              t: "A number that moves",
              d: "Sleep, movement, and your lab trends shift your biological age — and your QYL with it. You watch effort convert into time, month over month.",
            },
          ].map(s => (
            <div key={s.n} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
              <span className="text-green-400 font-bold text-sm">{s.n}</span>
              <p className="font-semibold text-zinc-100 mt-1">{s.t}</p>
              <p className="text-xs text-zinc-400 mt-2 leading-relaxed">{s.d}</p>
            </div>
          ))}
        </div>
        <p className="text-center text-[11px] text-zinc-600 mt-6 max-w-lg mx-auto leading-relaxed">
          An estimate with a wide honest range — population statistics, not a
          prediction and not medical advice. The point isn&apos;t the number;
          it&apos;s which way it moves.
        </p>
      </section>

      {/* Bridge to BackNine */}
      <section className="border-t border-zinc-800/60">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 text-center">
          <p className="text-zinc-400 text-sm uppercase tracking-widest font-semibold">
            QYL Index is part of
          </p>
          <p className="text-3xl font-bold mt-2">
            <span className="text-white">Back</span>
            <span className="text-green-400">Nine</span>
          </p>
          <p className="mt-4 text-zinc-400 max-w-xl mx-auto leading-relaxed">
            Your biological age, weekly health span score, doctor-ready
            reports — and a leaderboard of friends keeping each other
            honest. Because nobody adds quality years alone.
          </p>
          <Link
            href="/signin"
            className="inline-block mt-6 rounded-xl bg-green-500 hover:bg-green-400 text-black font-bold px-8 py-3 transition-colors"
          >
            Start free
          </Link>
          <p className="mt-6 text-zinc-700 text-[11px]">
            © Strategy D, Inc · <Link href="/support" className="hover:text-zinc-500">Support</Link> · <Link href="/" className="hover:text-zinc-500">backnine.health</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
