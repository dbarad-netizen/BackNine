"use client";

/**
 * BackNine marketing landing page (David 2026-07-23, Fable competitive
 * brief 2026-07-05).
 *
 * The sign-in wall was the top competitive liability in the July 2026
 * review — every prospect had to sign up before seeing what the app
 * did. This page fixes that: doctor-layer hero, foursome demo,
 * transparency-vs-Bevel comparison table, honest pricing, single
 * "Get started free" CTA that leads to /signin.
 *
 * The old sign-in form now lives at /signin. Users who are already
 * authenticated fall through to /dashboard via the useEffect below.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

export default function LandingPage() {
  const router = useRouter();

  // If user is already signed in, take them straight to the dashboard.
  // Marketing pages shouldn't gate returning users.
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (data.session) {
        router.replace("/dashboard");
        return;
      }
      const existing = typeof window !== "undefined" && localStorage.getItem("bn_token");
      if (existing) {
        router.replace("/dashboard");
        return;
      }
      // Last resort before showing the login page: the native token
      // vault (task #119). iOS tracking prevention purges webview
      // storage ~weekly, which dumped signed-in users here — the
      // "keeps asking me to log in to Oura" bug. The native copy
      // survives every purge.
      const { restoreTokenFromNative } = await import("@/lib/api");
      if (await restoreTokenFromNative()) router.replace("/dashboard");
    });
  }, [router]);

  return (
    <main className="bg-[#0f1a15] text-zinc-100 min-h-screen">

      {/* ── Top nav ── */}
      <nav className="border-b border-zinc-800/60 bg-[#0f1a15]/95 backdrop-blur sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <Link href="/" className="text-lg font-bold tracking-tight">
            <span className="text-white">Back</span><span className="text-green-400">Nine</span>
          </Link>
          <div className="flex items-center gap-2 sm:gap-4 text-sm">
            <Link href="/support" className="text-zinc-400 hover:text-white hidden sm:inline">Support</Link>
            <Link
              href="/signin"
              className="rounded-lg bg-green-500 hover:bg-green-400 text-black font-semibold px-3 sm:px-4 py-1.5 transition-colors"
            >
              Sign in
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 pt-16 pb-20 text-center">
        <p className="inline-block text-[11px] font-semibold uppercase tracking-widest text-green-400 bg-green-950/60 border border-green-800 rounded-full px-3 py-1 mb-6">
          Healthspan coach for men 50+
        </p>
        <h1 className="text-4xl sm:text-6xl font-bold tracking-tight text-white leading-tight">
          Your doctor gets a report,
          <br />
          <span className="text-green-400">not a black box.</span>
        </h1>
        <p className="mt-6 text-lg sm:text-xl text-zinc-300 max-w-2xl mx-auto leading-relaxed">
          BackNine reads the Apple Watch or Oura ring you already own — plus your
          labs, meds, and blood pressure — shows its math, and tells you what
          today is buying you in quality years.
        </p>
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/signin"
            className="w-full sm:w-auto rounded-xl bg-green-500 hover:bg-green-400 text-black font-semibold text-base px-8 py-3.5 transition-colors"
          >
            Get started — it&rsquo;s free
          </Link>
          <a
            href="#how-it-works"
            className="text-sm text-zinc-400 hover:text-white transition-colors px-4 py-2"
          >
            See how it works ↓
          </a>
        </div>
        <p className="mt-4 text-xs text-zinc-500">
          Free at launch. Works with the Apple Watch you already own, or Oura. No ads, no data sales.
        </p>
        {/* Founder line (David 2026-09-21): people don't read policies;
            they read who's asking. A named 58-year-old using it on himself
            is a different proposition from an anonymous developer. */}
        <p className="mt-6 text-sm text-zinc-400">
          Built by <span className="text-zinc-200 font-medium">David B., 58</span>, for his own
          foursome — and run on his own numbers every morning.
        </p>
      </section>

      {/* ── Doctor Layer — the differentiator ── */}
      <section className="border-t border-zinc-800/60 bg-[#0f1a15]" id="how-it-works">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-green-400 mb-2">
            The doctor layer
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
            Show up prepared to every visit.
          </h2>
          <p className="mt-4 text-lg text-zinc-300 max-w-2xl leading-relaxed">
            Blood pressure history. Labs with reference ranges. Current meds.
            Recent symptoms. A one-page PDF you can email your doctor or bring
            to your next appointment — the summary they actually want to see.
          </p>

          <ul className="mt-8 grid sm:grid-cols-3 gap-4">
            {[
              { emoji: "📄", title: "Doctor Report",  body: "One-page PDF summarizing your BP, sleep, weight, and lab trends. Print it, email it, share a private link." },
              { emoji: "🩺", title: "Visit Prep Mode", body: "Two weeks before your appointment, we help you draft the questions worth asking based on what your data shows." },
              { emoji: "🚨", title: "Clinical Flags",  body: "Sustained blood pressure over 140/90? We surface it here and in the report. No opinions — the numbers, sourced." },
            ].map(f => (
              <li key={f.title} className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
                <p className="text-2xl mb-2">{f.emoji}</p>
                <p className="font-semibold text-white">{f.title}</p>
                <p className="mt-1 text-sm text-zinc-400 leading-relaxed">{f.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Foursome ── */}
      <section className="border-t border-zinc-800/60 bg-gradient-to-b from-[#0f1a15] to-[#0a1310]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-green-400 mb-2">
            Longevity is a team sport
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
            Bring your foursome.
          </h2>
          <p className="mt-4 text-lg text-zinc-300 max-w-2xl leading-relaxed">
            Invite your spouse, workout partners, or the guys you tee off with
            Saturday. A weekly league, a Sunday scoreboard, and a coffee tab
            for whoever finishes last. People quit alone. Nobody quits the
            week the coffee&rsquo;s on them.
          </p>

          <div className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
            <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-3">
              Weekly League preview · Health Span score
            </p>
            <ul className="space-y-2">
              {[
                { name: "Alex",   pts: 88, mine: false },
                { name: "You",    pts: 84, mine: true  },
                { name: "Sam",    pts: 79, mine: false },
                { name: "Jordan", pts: 71, mine: false },
              ].map((r, i) => (
                <li
                  key={r.name}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 ${
                    r.mine ? "bg-green-950/60 border border-green-800" : "bg-zinc-950/40"
                  }`}
                >
                  <span className="w-6 text-center text-sm font-semibold text-zinc-400">{i + 1}</span>
                  <span className={`flex-1 text-sm ${r.mine ? "text-white font-semibold" : "text-zinc-300"}`}>
                    {r.name}
                  </span>
                  <span className={`text-sm font-mono ${r.mine ? "text-green-400" : "text-zinc-500"}`}>
                    {r.pts}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] text-zinc-500">
              Scored on sleep, movement and consistency — not on which gadget you own. Lowest score buys the coffee.
            </p>
          </div>
        </div>
      </section>

      {/* ── "Why not just use the Oura app?" — David 2026-09-21. The
          top comment on every new health app is "what does this do that
          my watch's app doesn't?" (64 upvotes on the Baro thread).
          Answer it before it's asked, in three lines. */}
      <section className="border-t border-zinc-800/60 bg-[#0a1310]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-green-400 mb-2">
            The fair question
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
            Why not just use the Oura app? Or Apple Health?
          </h2>
          <p className="mt-4 text-lg text-zinc-300 max-w-2xl leading-relaxed">
            Use them — we do. They tell you how you slept and how recovered you
            are <em>today</em>, and they&rsquo;re getting better at it every year.
            BackNine does three things they can&rsquo;t:
          </p>
          {/* Reordered 2026-10-22 after Oura shipped lab upload + Counsel:
              the doctor report is becoming table stakes inside the ring's
              own app. Lead with what a single-device, single-person app
              structurally can't do — the foursome — and the math. */}
          <div className="mt-8 grid sm:grid-cols-3 gap-4">
            {[
              ["Your foursome, played net", "A weekly league your friends can join from any watch or ring — scored like golf, against your own par, so the fit guy and the guy getting started play the same game. Lowest net buys the coffee."],
              ["Every score, with the math", "Tap any number and see what moved it. Your ring's app tells you a score; we show you the work, and we'll say out loud when we're not sure."],
              ["Years, not days", "Readiness is about this morning. Your Health Span score, Biological Age and QYL Index are about the next twenty years — and they move when your habits do. The doctor report is the receipt."],
            ].map(([t, d]) => (
              <div key={t} className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
                <p className="font-semibold text-white">{t}</p>
                <p className="mt-2 text-sm text-zinc-400 leading-relaxed">{d}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-sm text-zinc-500">
            If all you want is a prettier recovery dashboard, there are good free ones. That&rsquo;s not this.
          </p>
        </div>
      </section>

      {/* ── Transparency ── */}
      <section className="border-t border-zinc-800/60 bg-[#0f1a15]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-green-400 mb-2">
            Show your math
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
            Every score, sourced.
          </h2>
          <p className="mt-4 text-lg text-zinc-300 max-w-2xl leading-relaxed">
            Biological Age, Health Span, the QYL Index — none of them is a black
            box. Tap any score to see which markers rolled up, how each one moved
            the number, and how recent the data is. The full methodology is
            public:{" "}
            <Link href="/how-we-score" className="text-green-400 underline underline-offset-2 hover:text-green-300">
              how we score you
            </Link>
            . If we&rsquo;re not confident, we say so.
          </p>

          {/* Comparison table */}
          <div className="mt-8 overflow-hidden rounded-2xl border border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900/60">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-zinc-300">Feature</th>
                  <th className="text-center px-4 py-3 font-semibold text-green-400">BackNine</th>
                  <th className="text-center px-4 py-3 font-semibold text-zinc-500">Bevel Pro</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70">
                {[
                  ["Shows what moved the score",                "Yes",       "No"],
                  ["Doctor-facing one-page report",             "Yes",       "No"],
                  ["Community — friends, leaderboards, groups", "Yes",       "No"],
                  ["Age-relative norms (50+)",                  "Yes",       "General population"],
                  ["Meds + supplement adherence",               "Yes",       "No"],
                  ["Price",                                     "Free in beta", "Free · Pro $14.99/mo"],
                ].map(([label, a, b]) => (
                  <tr key={label} className="bg-zinc-950/30">
                    <td className="px-4 py-3 text-zinc-300">{label}</td>
                    <td className="px-4 py-3 text-center text-white font-semibold">{a}</td>
                    <td className="px-4 py-3 text-center text-zinc-500">{b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Competitor facts go stale. Date them, name the source, and
              re-check quarterly — "show your math" applies to this table
              too. Last verified 2026-10-15 (Bevel made all but its AI
              coach free in Dec 2025; Pro is the AI tier). */}
          <p className="mt-2 text-[11px] text-zinc-500">
            Bevel features and pricing as listed by Bevel, checked Oct 2026. If we got something wrong, tell us and we&rsquo;ll fix it.
          </p>
        </div>
      </section>

      {/* ── Six pillars ── */}
      <section className="border-t border-zinc-800/60 bg-[#0a1310]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-green-400 mb-2">
            Six pillars, one dashboard
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
            The whole picture. In under a minute a day.
          </h2>

          <ul className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { emoji: "😴", title: "Sleep",     body: "Hours, stages, bedtime drift, split nights — from the device you already wear." },
              { emoji: "❤️", title: "Recovery",  body: "HRV + RHR trends turned into today's readiness call." },
              { emoji: "🏋️", title: "Training",  body: "One workout a day tuned to how you slept and what you did yesterday." },
              { emoji: "🥗", title: "Nutrition", body: "Protein streak, meal photos, meds + supplement adherence." },
              { emoji: "💡", title: "Insight",   body: "Coach Al’s morning read — what last night means for today, in plain English." },
              { emoji: "🤝", title: "Community", body: "Your foursome: the Weekly League, the Sunday scoreboard, the Coffee Tab." },
            ].map(p => (
              <li key={p.title} className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
                <p className="text-2xl mb-2">{p.emoji}</p>
                <p className="font-semibold text-white">{p.title}</p>
                <p className="mt-1 text-sm text-zinc-400 leading-relaxed">{p.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Bottom CTA ── */}
      <section className="border-t border-zinc-800/60 bg-[#0f1a15]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 sm:py-20 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
            Play your back nine well.
          </h2>
          <p className="mt-4 text-lg text-zinc-300 leading-relaxed">
            Free while we&rsquo;re in beta. Works with Apple Watch or Oura.
            Recovery apps tell you about today — BackNine tells you what today
            is buying you.
          </p>
          <p className="mt-3 text-sm text-zinc-500 leading-relaxed">
            The deal: we&rsquo;ll charge for BackNine Pro later, and that&rsquo;s
            how we make money. We will never sell your data or show you ads.{" "}
            <Link href="/your-data" className="underline underline-offset-2 hover:text-zinc-300">
              Your data stays yours.
            </Link>
          </p>
          <Link
            href="/signin"
            className="mt-8 inline-block rounded-xl bg-green-500 hover:bg-green-400 text-black font-semibold text-base px-8 py-3.5 transition-colors"
          >
            Get started — it&rsquo;s free
          </Link>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-zinc-800/60 bg-[#0a1310] text-xs text-zinc-500">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Link href="/support"    className="hover:text-white">Support</Link>
            <Link href="/terms"      className="hover:text-white">Terms</Link>
            <Link href="/privacy"    className="hover:text-white">Privacy</Link>
            <Link href="/your-data"  className="hover:text-white">Your data</Link>
            <Link href="/how-we-score" className="hover:text-white">How we score</Link>
            <Link href="/disclaimer" className="hover:text-white">Health Disclaimer</Link>
          </div>
          <p className="leading-relaxed">
            BackNine is not a medical device and does not provide medical
            advice, diagnosis, or treatment. Always consult a qualified
            healthcare professional before making health decisions.
          </p>
          <p>&copy; {new Date().getFullYear()} Strategy D, Incorporated.</p>
        </div>
      </footer>
    </main>
  );
}
