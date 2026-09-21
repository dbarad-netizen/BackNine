import Link from "next/link";
import type { Metadata } from "next";

/**
 * /how-we-score — public methodology (David 2026-09-21).
 *
 * From the Baro Reddit thread: "What do you use for Fitness Age?" →
 * "I'll write a blog post" read as "I don't have one." Every BackNine
 * score already shows its math in-app (Under the hood); this page makes
 * the same math public so skeptics, reviewers, and doctors can read it
 * BEFORE they ask. Constants here mirror backend/biological_age.py,
 * backend/healthspan.py, and backend/apple_health.py — update both when
 * the math changes.
 */

export const metadata: Metadata = {
  title: "How BackNine scores you — the math behind every number",
  description:
    "Biological Age, Health Span Score, the QYL Index, and BackNine-computed rings: every input, every weight, every cap. No black boxes.",
};

const BIO_MARKERS = [
  ["VO₂ max", "5 yrs/SD", "20%"],
  ["Systolic blood pressure", "4 yrs/SD", "16%"],
  ["Heart rate variability", "4 yrs/SD", "14%"],
  ["HbA1c", "4 yrs/SD", "14%"],
  ["Resting heart rate", "3 yrs/SD", "10%"],
  ["LDL cholesterol", "3 yrs/SD", "10%"],
  ["hsCRP", "3 yrs/SD", "8%"],
  ["eGFR (kidney)", "4 yrs/SD", "8%"],
  ["Fasting glucose", "3 yrs/SD", "6%"],
  ["Body fat", "2 yrs/SD", "5%"],
  ["HDL cholesterol", "2 yrs/SD", "5%"],
  ["Triglycerides", "2 yrs/SD", "5%"],
  ["Sleep (7-day average)", "2 yrs/SD", "3%"],
];

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-2xl sm:text-3xl font-bold text-white mt-14 mb-4">{children}</h2>;
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="text-zinc-300 leading-relaxed mb-4">{children}</p>;
}
function Rule({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-green-900/60 bg-[#13241c] px-4 py-3 text-sm text-zinc-200 mb-4">
      {children}
    </div>
  );
}

export default function HowWeScorePage() {
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

      <article className="max-w-3xl mx-auto px-4 sm:px-6 pt-14 pb-20">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-green-400 mb-2">Methodology</p>
        <h1 className="text-4xl sm:text-5xl font-bold leading-tight">
          How BackNine scores you.
        </h1>
        <P>
          Every number in BackNine has an &ldquo;Under the hood&rdquo; view in the app
          that lists its inputs and how each one moved the result. This page is the
          same math, written out once, in public — so you can check it before you
          trust it. If we can&apos;t show the math, we don&apos;t show the score.
        </P>
        <Rule>
          <span className="font-semibold text-white">Ground rule:</span> scores come from
          sensors and labs, never from what you log. Logging diligence isn&apos;t health.
        </Rule>

        {/* ── Biological Age ── */}
        <H2>Biological Age</H2>
        <P>
          Your body&apos;s age as read from up to thirteen markers — wearable-derived
          (HRV, resting heart rate, VO₂ max, sleep, body fat), blood pressure, and
          labs you upload (HbA1c, LDL, HDL, triglycerides, fasting glucose, hsCRP,
          eGFR). Four steps:
        </P>
        <ol className="list-decimal pl-6 space-y-2 text-zinc-300 mb-4">
          <li>
            For each marker, we compute the <span className="text-white">population-typical</span> value
            for your age and sex — what an average person your age actually measures,
            not an athlete&apos;s optimum. (Typical body fat for a 58-year-old man is
            about 26%, not 15%.)
          </li>
          <li>
            Your reading becomes a z-score: how many standard deviations you sit from
            typical, in the direction that matters (lower LDL is better; higher VO₂ max
            is better).
          </li>
          <li>
            Each marker&apos;s z-score converts to years using its clinical signal
            weight — how strongly that marker tracks with mortality in the literature —
            and is <span className="text-white">capped at ±6 years</span> so no single lab
            result can dominate.
          </li>
          <li>
            The weighted average of those year-deltas is added to your chronological
            age. We need at least three markers to show a number; fewer would be false
            precision.
          </li>
        </ol>
        <div className="overflow-x-auto rounded-xl border border-zinc-800 mb-4">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900/60 text-zinc-400 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Marker</th>
                <th className="px-3 py-2 font-medium">Years per SD</th>
                <th className="px-3 py-2 font-medium">Weight</th>
              </tr>
            </thead>
            <tbody>
              {BIO_MARKERS.map(([m, y, w]) => (
                <tr key={m} className="border-t border-zinc-800/60">
                  <td className="px-3 py-2 text-zinc-200">{m}</td>
                  <td className="px-3 py-2 text-zinc-400">{y}</td>
                  <td className="px-3 py-2 text-zinc-400">{w}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <P>
          Confidence is labeled high, medium, or low based on how many markers are
          present. When you have both creatinine-based and cystatin-C-based eGFR, we
          use cystatin C — it isn&apos;t skewed by muscle mass.
        </P>

        {/* ── Health Span ── */}
        <H2>Weekly Health Span Score</H2>
        <P>
          The process score: what your habits did this week, from sensors only. Four
          bands, each with a point ceiling, normalized to 100 across whichever bands
          your devices can measure (minimum two).
        </P>
        <ul className="space-y-2 text-zinc-300 mb-4">
          <li><span className="text-white font-medium">Sleep hours</span> (15 pts) — 7-day average. Full marks at 7–9 h; 6.5–7 or 9–10 h scores lower; under 6 h scores lowest.</li>
          <li><span className="text-white font-medium">Sleep consistency</span> (10 pts, Oura) — bedtime standard deviation. Under 30 min = 10, under 45 = 7, under 60 = 4.</li>
          <li><span className="text-white font-medium">Steps</span> (10 pts) — 7-day average. 7,500+ = 10, 6,000+ = 8, 4,500+ = 6, 3,000+ = 4, else 2.</li>
          <li><span className="text-white font-medium">Active days</span> (15 pts) — days with ≥300 active kcal or a detected workout. 5+ days = 15, 4 = 12, 3 = 9, 2 = 6, 1 = 3.</li>
        </ul>
        <P>
          Grades: 85+ Excellent, 70+ Good, 55+ Fair. The Weekly Leaderboard ranks on
          this score, so everyone is compared on behavior, not on who owns the fanciest
          ring.
        </P>

        {/* ── QYL ── */}
        <H2>QYL Index — Quality Years Left</H2>
        <P>
          The horizon number. Standard actuarial life tables give the expected remaining
          years for a person of your age and sex. We scale that by the share of
          remaining life the average US adult spends active and independent (about
          70%) — that&apos;s <em>healthspan</em>, not lifespan. Then the key move: we
          evaluate those tables at your <span className="text-white">biological</span> age,
          not your birthday age. Two years biologically younger means the table pays
          out as if you were two years younger.
        </P>
        <Rule>
          Shown as a range, deliberately. Population variance dwarfs model precision, so
          the card says &ldquo;likely 12–22&rdquo; (±25%), and the point isn&apos;t the
          number — it&apos;s which way it moves as your markers move. A new user with
          only an age sees a starting estimate labeled as such until three markers
          exist.
        </Rule>

        {/* ── Rings ── */}
        <H2>BackNine-computed rings (Apple Health users)</H2>
        <P>
          Oura users see Oura&apos;s own Readiness, Sleep, and Activity scores. Apple
          Health users get scores we compute from the same kinds of inputs, marked
          &ldquo;≈ computed by BackNine&rdquo; so nobody mistakes them for a
          manufacturer&apos;s number.
        </P>
        <ul className="space-y-2 text-zinc-300 mb-4">
          <li><span className="text-white font-medium">Sleep</span> — duration band (85–100 for 7–9 h, tapering outside) × quality, where quality is the deep + REM share of the night (healthy ≈ 35–45%). Without stage data the score caps at 90: we won&apos;t certify a perfect night we didn&apos;t see.</li>
          <li><span className="text-white font-medium">Activity</span> — 70% from steps against 10,000, 30% from active calories against 600.</li>
          <li><span className="text-white font-medium">Readiness</span> — 75 baseline, moved up to ±60 points by how today&apos;s HRV and resting heart rate compare to your own 14-day baseline, clamped 35–98.</li>
        </ul>

        <H2>What we don&apos;t do</H2>
        <P>
          No score is adjusted for engagement, streaks, or how often you open the app.
          Family history is shown to you and included in doctor reports as screening
          context, but it is deliberately kept out of the Bio Age and QYL math — your
          measured markers already express your genetics, and parental lifespan is a
          weak, confounded signal. Nothing here is a diagnosis or a prediction for you
          as an individual; it&apos;s population statistics applied honestly, meant to
          be read with your doctor.
        </P>

        <div className="mt-10 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 text-sm text-zinc-400">
          Spot an error or have a better source for a weight? <Link href="/support" className="text-green-400 underline underline-offset-2">Tell us</Link> — the math is meant to be argued with.
          <span className="block mt-3"><Link href="/your-data" className="hover:text-zinc-200 underline underline-offset-2">Your data</Link> · <Link href="/privacy" className="hover:text-zinc-200 underline underline-offset-2">Privacy</Link></span>
        </div>
      </article>
    </main>
  );
}
