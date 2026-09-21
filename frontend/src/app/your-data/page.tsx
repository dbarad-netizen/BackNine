import Link from "next/link";
import type { Metadata } from "next";

/**
 * /your-data — plain-English data practices (David 2026-09-21).
 *
 * Competitive review of the Apple Watch recovery-app category: every
 * competitor markets "on-device, no account, no cloud" as a virtue, and
 * cloud-based apps get filed under "sends your data to the cloud" by
 * default. BackNine is cloud-based by design (Coach Al, leagues, doctor
 * reports need a server), so the answer is to be loud and specific about
 * what we do and don't do — not silent. The legal Privacy Policy still
 * governs; this page is the human version, and links to it.
 */

export const metadata: Metadata = {
  title: "Your data — BackNine",
  description:
    "What BackNine collects, what it never does with it, and how to export or delete everything in one tap.",
};

const NEVER = [
  ["No ads", "BackNine shows no advertising and never will trade your attention for revenue."],
  ["No data sales", "We do not sell, rent, or license your health data. Not anonymized, not aggregated, not ever."],
  ["No insurers, no employers", "Nothing about you goes to an insurer, an employer, a data broker, or a benefits program."],
  ["No AI training on your data", "Coach Al runs on Anthropic's Claude. Our provider does not train its models on our API traffic — your briefings and chats are processed and returned, not learned from."],
  ["No silent sharing", "Friends see only what you choose to put on a leaderboard. Doctors see a report only when you generate a link and hand it over."],
];

const COLLECT = [
  ["From your wearable", "Sleep, readiness, HRV, resting heart rate, steps, workouts — from Oura or Apple Health, only after you connect them. Disconnect any time."],
  ["What you log", "Meals, blood pressure, supplements, mood, symptoms, labs you upload. Only what you enter."],
  ["Your profile", "Age, sex, height, goals, family history — the minimum needed to score you against people like you."],
  ["Account basics", "Your sign-in identity (Apple, Google, Oura, or email). We never see your password."],
];

export default function YourDataPage() {
  return (
    <main className="bg-[#0f1a15] text-zinc-100 min-h-screen">
      <nav className="border-b border-zinc-800/60 sticky top-0 z-30 bg-[#0f1a15]/95 backdrop-blur">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <Link href="/" className="text-lg font-bold tracking-tight">
            <span className="text-white">Back</span><span className="text-green-400">Nine</span>
          </Link>
          <Link href="/signin" className="rounded-lg bg-green-500 hover:bg-green-400 text-black font-semibold px-4 py-1.5 text-sm transition-colors">
            Sign in
          </Link>
        </div>
      </nav>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 pt-14 pb-10">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-green-400 mb-2">Your data</p>
        <h1 className="text-4xl sm:text-5xl font-bold leading-tight">
          It&apos;s yours. Here&apos;s exactly what we do with it.
        </h1>
        <p className="mt-5 text-zinc-400 text-lg leading-relaxed max-w-2xl">
          BackNine runs in the cloud — Coach Al, your weekly league, and doctor-ready
          reports can&apos;t live on a watch. That means we owe you a plain answer to
          &ldquo;where does my health data go?&rdquo; This is it.
        </p>
        {/* Business model up front (2026-09-21): "if it's free, you are the
            product" is the reflex reaction to a free health app. Saying we
            intend to CHARGE is the strongest answer to it. */}
        <div className="mt-6 rounded-xl border-2 border-green-500/60 bg-green-950/30 p-4 max-w-2xl">
          <p className="font-semibold text-white">How we make money — so you&apos;re not the product</p>
          <p className="text-sm text-zinc-300 mt-1 leading-relaxed">
            BackNine is free while we&apos;re in beta. Later, we&apos;ll charge a
            subscription for BackNine Pro. That&apos;s the entire business model:
            you pay us, or you don&apos;t — nobody else ever does. No ads, no data
            sales, no &ldquo;partners.&rdquo; If that ever changes, we&apos;ll tell
            you before it does, not after.
          </p>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 pb-12">
        <h2 className="text-2xl font-bold mb-5">What we never do</h2>
        <div className="space-y-3">
          {NEVER.map(([t, d]) => (
            <div key={t} className="rounded-xl border border-green-900/60 bg-[#13241c] p-4 flex gap-3">
              <span className="text-green-400 font-bold text-lg leading-none mt-0.5">✕</span>
              <div>
                <p className="font-semibold text-white">{t}</p>
                <p className="text-sm text-zinc-400 mt-1 leading-relaxed">{d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 pb-12">
        <h2 className="text-2xl font-bold mb-5">What we collect — and why</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          {COLLECT.map(([t, d]) => (
            <div key={t} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
              <p className="font-semibold text-white">{t}</p>
              <p className="text-sm text-zinc-400 mt-1 leading-relaxed">{d}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-sm text-zinc-500 leading-relaxed">
          Stored with Supabase on servers in the United States, encrypted in transit
          and at rest, with row-level security so each account can only ever read its
          own rows.
        </p>
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 pb-12">
        <h2 className="text-2xl font-bold mb-5">Two buttons, no tickets</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <p className="font-semibold text-white">Export everything</p>
            <p className="text-sm text-zinc-400 mt-1 leading-relaxed">
              One tap in your Profile downloads every row we hold on you as a file you
              can open anywhere. No request form, no waiting period.
            </p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <p className="font-semibold text-white">Delete your account</p>
            <p className="text-sm text-zinc-400 mt-1 leading-relaxed">
              One tap in your Profile schedules your account and every record attached
              to it — wearable data, logs, briefings, reports — for permanent deletion.
              A 7-day grace window lets you change your mind; after that it&apos;s gone,
              not archived.
            </p>
          </div>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 pb-12">
        <h2 className="text-2xl font-bold mb-3">Show your work, always</h2>
        <p className="text-zinc-400 leading-relaxed">
          Every score in BackNine — Health Span, Biological Age, the QYL Index — has an
          &ldquo;Under the hood&rdquo; view that lists the exact inputs and how each one
          moved the number. No black boxes: if we can&apos;t show the math, we don&apos;t
          show the score.
        </p>
      </section>

      <section className="border-t border-zinc-800/60">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 text-center text-sm text-zinc-500 space-x-3">
          <Link href="/privacy" className="hover:text-zinc-300 underline underline-offset-2">Full Privacy Policy</Link>
          <span>·</span>
          <Link href="/terms" className="hover:text-zinc-300 underline underline-offset-2">Terms</Link>
          <span>·</span>
          <Link href="/support" className="hover:text-zinc-300 underline underline-offset-2">Support</Link>
          <p className="mt-4 text-zinc-700 text-[11px]">© Strategy D, Inc</p>
        </div>
      </section>
    </main>
  );
}
