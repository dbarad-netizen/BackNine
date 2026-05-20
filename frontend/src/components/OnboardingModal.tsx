"use client";

/**
 * OnboardingModal — first-time setup flow.
 *
 * Shown once (gated on user_profiles.onboarded_at). Four steps:
 *   1. Welcome — what BackNine is
 *   2. Profile — display name + age + biological sex
 *   3. Data sources — Oura / Apple Health / manual-only (equal weight so
 *      non-Oura users feel welcomed)
 *   4. Invite a friend — generate a code or skip
 *
 * Calls completeOnboarding() on finish so it never reappears.
 */

import { useState } from "react";
import { api } from "@/lib/api";

const BACKEND = "https://backnine-hu60.onrender.com";

interface Props {
  onDone: () => void;
}

type Step = 0 | 1 | 2 | 3;

export default function OnboardingModal({ onDone }: Props) {
  const [step, setStep] = useState<Step>(0);
  const [finishing, setFinishing] = useState(false);

  // Profile fields
  const [name, setName] = useState("");
  const [age, setAge]   = useState("");
  const [sex, setSex]   = useState<"male" | "female" | null>(null);

  // Invite
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const saveProfile = async () => {
    // Best-effort — don't block onboarding if the save hiccups
    try {
      await api.saveProfile({
        name: name.trim() || null,
        age: age ? parseInt(age) : null,
        biological_sex: sex,
      });
    } catch { /* ignore */ }
  };

  // localStorage backstop — guarantees onboarding can't re-loop even if the
  // backend write fails (e.g. the onboarded_at column hasn't been migrated yet).
  const markOnboardedLocally = () => {
    try { localStorage.setItem("bn_onboarded", "1"); } catch { /* ignore */ }
  };

  const finish = async () => {
    setFinishing(true);
    await saveProfile();
    markOnboardedLocally();
    try { await api.completeOnboarding(); } catch { /* ignore */ }
    onDone();
  };

  // Connecting Oura navigates the browser away, so we MUST persist the
  // onboarding-complete state before redirecting — otherwise returning from
  // Oura re-triggers the whole flow.
  const handleConnectOura = async () => {
    await saveProfile();
    markOnboardedLocally();
    try { await api.completeOnboarding(); } catch { /* ignore */ }
    window.location.href = `${BACKEND}/auth/oura`;
  };

  const handleGenerateInvite = async () => {
    setInviteLoading(true);
    try {
      const inv = await api.friends.invite();
      setInviteCode(inv.code);
    } catch { /* ignore */ }
    finally { setInviteLoading(false); }
  };

  const handleCopy = () => {
    if (!inviteCode) return;
    navigator.clipboard.writeText(inviteCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  const inp = "w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-[#1B3829] focus:ring-1 focus:ring-[#1B3829]/20";

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
      <div className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-50 mx-auto max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
        {/* Progress dots */}
        <div className="flex gap-1.5 px-5 pt-5">
          {[0, 1, 2, 3].map(i => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition-colors ${
                i <= step ? "bg-[#1B3829]" : "bg-gray-200"
              }`}
            />
          ))}
        </div>

        <div className="px-6 py-6 min-h-[20rem] flex flex-col">
          {/* ── Step 0: Welcome ── */}
          {step === 0 && (
            <div className="flex-1 flex flex-col">
              <div className="flex-1">
                <p className="text-3xl mb-3">👋</p>
                <h2 className="text-xl font-bold text-gray-900 mb-2">
                  Welcome to <span className="text-[#1B3829]">Back</span><span className="text-[#2D6A4F]">Nine</span>
                </h2>
                <p className="text-sm text-gray-600 leading-relaxed">
                  BackNine turns your health data and daily habits into a clear, daily plan —
                  with an AI coach, a longevity score, and friendly competition with friends.
                </p>
                <p className="text-sm text-gray-600 leading-relaxed mt-3">
                  Works with an Oura Ring, an Apple Watch, or just manual tracking. Let&apos;s
                  spend 60 seconds setting you up.
                </p>
              </div>
              <button
                onClick={() => setStep(1)}
                className="mt-6 w-full py-3 rounded-xl bg-[#1B3829] hover:bg-[#2D6A4F] text-white text-sm font-semibold transition-colors"
              >
                Get started
              </button>
            </div>
          )}

          {/* ── Step 1: Profile ── */}
          {step === 1 && (
            <div className="flex-1 flex flex-col">
              <div className="flex-1 space-y-4">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">A little about you</h2>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Your name is what friends see. Age &amp; sex make your longevity score accurate.
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1.5">Display Name</label>
                  <input
                    className={inp}
                    placeholder="e.g. David B."
                    maxLength={40}
                    value={name}
                    onChange={e => setName(e.target.value)}
                  />
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1.5">Age</label>
                    <input
                      className={inp}
                      type="number"
                      min={10}
                      max={120}
                      placeholder="42"
                      value={age}
                      onChange={e => setAge(e.target.value)}
                    />
                  </div>
                  <div className="flex-[1.5]">
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1.5">Biological Sex</label>
                    <div className="flex gap-2">
                      {(["male", "female"] as const).map(s => (
                        <button
                          key={s}
                          onClick={() => setSex(s)}
                          className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors border ${
                            sex === s
                              ? "bg-[#1B3829] text-white border-[#1B3829]"
                              : "bg-gray-50 text-gray-600 border-gray-200 hover:border-gray-400"
                          }`}
                        >
                          {s === "male" ? "Male" : "Female"}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex gap-2 mt-6">
                <button onClick={() => setStep(0)} className="px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-600 hover:border-gray-400 transition-colors">Back</button>
                <button onClick={() => setStep(2)} className="flex-1 py-3 rounded-xl bg-[#1B3829] hover:bg-[#2D6A4F] text-white text-sm font-semibold transition-colors">Continue</button>
              </div>
            </div>
          )}

          {/* ── Step 2: Data sources ── */}
          {step === 2 && (
            <div className="flex-1 flex flex-col">
              <div className="flex-1 space-y-3">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">How do you track?</h2>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Connect a source for richer insights — or start with manual tracking and add one later.
                  </p>
                </div>

                {/* Oura — marks onboarding done before redirecting away */}
                <button
                  onClick={handleConnectOura}
                  className="w-full text-left block rounded-xl border border-gray-200 hover:border-[#1B3829]/40 p-3 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">💍</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900">Connect Oura Ring</p>
                      <p className="text-[11px] text-gray-500">Unlocks readiness, sleep, HRV, recovery</p>
                    </div>
                    <span className="text-gray-400 text-sm">→</span>
                  </div>
                </button>

                {/* Apple Health */}
                <div className="rounded-xl border border-gray-200 p-3">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">🍎</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900">Use Apple Health</p>
                      <p className="text-[11px] text-gray-500">Steps, sleep, HRV from your iPhone / Apple Watch — set up in the Metrics tab after this.</p>
                    </div>
                  </div>
                </div>

                {/* Manual */}
                <div className="rounded-xl border border-gray-200 p-3 bg-gray-50/60">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">✏️</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900">Just manual for now</p>
                      <p className="text-[11px] text-gray-500">Log workouts, weight, and mood by hand. Add a tracker anytime.</p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex gap-2 mt-6">
                <button onClick={() => setStep(1)} className="px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-600 hover:border-gray-400 transition-colors">Back</button>
                <button onClick={() => setStep(3)} className="flex-1 py-3 rounded-xl bg-[#1B3829] hover:bg-[#2D6A4F] text-white text-sm font-semibold transition-colors">Continue</button>
              </div>
            </div>
          )}

          {/* ── Step 3: Invite a friend ── */}
          {step === 3 && (
            <div className="flex-1 flex flex-col">
              <div className="flex-1 space-y-4">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">Better with friends 🤝</h2>
                  <p className="text-xs text-gray-500 mt-0.5">
                    BackNine is most fun when you compete with friends. Invite one now, or skip and do it later.
                  </p>
                </div>

                {!inviteCode ? (
                  <button
                    onClick={handleGenerateInvite}
                    disabled={inviteLoading}
                    className="w-full py-2.5 rounded-xl bg-[#1B3829]/8 border border-[#1B3829]/30 text-[#1B3829] text-sm font-semibold transition-colors disabled:opacity-50"
                    style={{ backgroundColor: "rgba(27,56,41,0.08)" }}
                  >
                    {inviteLoading ? "Generating…" : "Generate an invite code"}
                  </button>
                ) : (
                  <div className="rounded-xl bg-gradient-to-br from-[#1B3829] to-[#2D6A4F] px-4 py-3 text-white">
                    <p className="text-[10px] uppercase tracking-widest text-white/60 mb-1">Share this code</p>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-2xl font-mono font-bold tracking-widest">{inviteCode}</p>
                      <button onClick={handleCopy} className="text-xs bg-white/15 hover:bg-white/25 px-3 py-1.5 rounded-lg font-semibold transition-colors">
                        {copied ? "✓ Copied" : "Copy"}
                      </button>
                    </div>
                    <p className="text-[10px] text-white/60 mt-1.5">Text it to a friend — they paste it in their Friends tab. Expires in 72h.</p>
                  </div>
                )}
              </div>
              <div className="flex gap-2 mt-6">
                <button onClick={() => setStep(2)} className="px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-600 hover:border-gray-400 transition-colors">Back</button>
                <button
                  onClick={finish}
                  disabled={finishing}
                  className="flex-1 py-3 rounded-xl bg-[#1B3829] hover:bg-[#2D6A4F] text-white text-sm font-semibold transition-colors disabled:opacity-50"
                >
                  {finishing ? "Finishing…" : inviteCode ? "Done — go to dashboard" : "Skip for now"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
