"use client";

/**
 * /support — public support page.
 *
 * Required by App Store Connect (Support URL field) and by common
 * courtesy. Kept intentionally simple: an email address, a response-
 * time expectation, and a short FAQ. If we ever add live chat or a
 * ticketing system, this page becomes the front door.
 *
 * Route-level access: fully public — no auth wall. Reviewer needs to
 * reach this without an account. Enforced by not calling any auth
 * hooks in this component.
 */

import Link from "next/link";

const FAQ: { q: string; a: string }[] = [
  {
    q: "How do I connect my Oura ring?",
    a: "On the sign-in screen tap Sign in with Oura Ring. You'll bounce to Oura's site to approve, then land back on your BackNine dashboard with the last 365 days of data ready to go.",
  },
  {
    q: "I don't have an Oura ring — can I still use BackNine?",
    a: "Yes. Create an account with email + password. You can log sleep, weight, blood pressure, workouts, meals, and medications manually. HealthKit integration for Apple Watch users is planned for a future update.",
  },
  {
    q: "How do I reset my password?",
    a: "On the sign-in screen, tap Forgot password after entering your email. You'll get a reset link within a couple of minutes.",
  },
  {
    q: "Can I export my data?",
    a: "Yes. Open your profile menu → Account → Export my data. You'll get a JSON file with every reading, log, and message tied to your account.",
  },
  {
    q: "How do I delete my account?",
    a: "Profile menu → Account → Delete my account. Your data enters a 7-day grace window during which you can restore. After 7 days everything is permanently deleted.",
  },
  {
    q: "Is BackNine a medical device or does it give medical advice?",
    a: "No. BackNine is an informational and coaching tool. It does not diagnose, treat, or prevent any condition. Always talk to a qualified healthcare professional about your health decisions. See our Medical Disclaimer for the full statement.",
  },
  {
    q: "How does the Doctor Handoff work?",
    a: "It's a one-page PDF summarizing your recent blood pressure, sleep, weight, and lab trends. Generate it any time from the Scorecard tab, then print it or email it to your doctor before your next visit.",
  },
  {
    q: "How much does BackNine cost?",
    a: "BackNine is free. We're planning a subscription tier in the future for expanded features like unlimited Doctor Handoffs and family sharing — everything you use today will stay free.",
  },
];

export default function SupportPage() {
  return (
    <main className="min-h-screen bg-[#0f1a15] text-zinc-100 px-4 py-10">
      <div className="max-w-2xl md:max-w-3xl landscape:md:max-w-4xl mx-auto space-y-8">

        {/* Header */}
        <div className="text-center">
          <Link href="/" className="inline-block">
            <h1 className="text-3xl font-bold tracking-tight text-white">
              Back<span className="text-green-400">Nine</span>
            </h1>
          </Link>
          <p className="text-zinc-400 text-sm mt-1">Support</p>
        </div>

        {/* Contact */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 space-y-3">
          <h2 className="text-lg font-semibold text-white">Contact us</h2>
          <p className="text-sm text-zinc-300 leading-relaxed">
            Email{" "}
            <a
              href="mailto:support@backnine.health"
              className="text-green-400 underline hover:text-green-300"
            >
              support@backnine.health
            </a>{" "}
            and we&rsquo;ll get back to you within one business day. Include
            your account email and a short description of what you&rsquo;re
            seeing.
          </p>
          <p className="text-xs text-zinc-500 leading-relaxed">
            If your message concerns a health emergency, contact your
            healthcare provider or call your local emergency services (in
            the US, dial 911). BackNine is not a medical service.
          </p>
        </section>

        {/* FAQ */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 space-y-5">
          <h2 className="text-lg font-semibold text-white">
            Frequently asked questions
          </h2>
          <ul className="space-y-5">
            {FAQ.map(item => (
              <li key={item.q} className="space-y-1.5">
                <p className="text-sm font-semibold text-white">{item.q}</p>
                <p className="text-sm text-zinc-400 leading-relaxed">{item.a}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* Legal footer */}
        <div className="text-center text-xs text-zinc-500 pt-4 space-x-4">
          <Link href="/terms" className="underline hover:text-zinc-300">
            Terms
          </Link>
          <Link href="/privacy" className="underline hover:text-zinc-300">
            Privacy
          </Link>
          <Link href="/disclaimer" className="underline hover:text-zinc-300">
            Health Disclaimer
          </Link>
        </div>

        <p className="text-center text-[10px] text-zinc-600">
          &copy; {new Date().getFullYear()} Strategy D, Incorporated.
        </p>
      </div>
    </main>
  );
}
