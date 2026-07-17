"use client";

/**
 * ProfileModal — slide-in modal with two tabs:
 *
 *   Profile  → age / biological sex / health goals  (saves to /api/profile)
 *   Friends  → list current friends, invite a new one, paste an invite code
 *
 * The Friends tab is the user-facing surface for the community foundation:
 * friend graph (friendships table) + invite codes (friend_invites table).
 */

import { useState, useEffect, useCallback } from "react";
import { api, localToday, type UserProfile, type Friend, type FriendInvite, type RelationshipType } from "@/lib/api";
import OuraPauseToggle from "./OuraPauseToggle";

const GOAL_OPTIONS = [
  { id: "longevity",      label: "Longevity",         icon: "🧬" },
  { id: "weight_loss",    label: "Weight Loss",        icon: "⚖️" },
  { id: "muscle_gain",    label: "Muscle Gain",        icon: "💪" },
  { id: "better_sleep",   label: "Better Sleep",       icon: "😴" },
  { id: "stress_reduce",  label: "Reduce Stress",      icon: "🧘" },
  { id: "cardio",         label: "Cardio Fitness",     icon: "🏃" },
  { id: "energy",         label: "More Energy",        icon: "⚡" },
  { id: "nutrition",      label: "Improve Nutrition",  icon: "🥗" },
];

type Tab = "profile" | "friends";

interface Props {
  onClose: () => void;
  /** Which tab to open initially. Defaults to "profile". */
  initialTab?: Tab;
}

export default function ProfileModal({ onClose, initialTab = "profile" }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab);

  // ── Profile state ──
  const [profile,  setProfile]  = useState<UserProfile>({ name: null, age: null, birthdate: null, biological_sex: null, height_cm: null, health_goals: [] });
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  // Height inputs — we store cm in the DB but US users think in ft/in.
  // These two strings are the source of truth while the modal is open; on
  // save we convert ft+in → cm and stuff into profile.height_cm.
  const [heightFt, setHeightFt] = useState<string>("");
  const [heightIn, setHeightIn] = useState<string>("");

  useEffect(() => {
    api.getProfile()
      .then(p => {
        setProfile({
          name:           p.name ?? null,
          age:            p.age ?? null,
          birthdate:      p.birthdate ?? null,
          biological_sex: p.biological_sex ?? null,
          height_cm:      p.height_cm ?? null,
          health_goals:   p.health_goals ?? [],
        });
        // Convert existing cm value to ft/in for the form.
        if (p.height_cm != null) {
          const totalIn = p.height_cm / 2.54;
          const ft = Math.floor(totalIn / 12);
          const inches = Math.round(totalIn - ft * 12);
          setHeightFt(String(ft));
          setHeightIn(String(inches));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const toggleGoal = (id: string) => {
    setProfile(prev => {
      const goals = prev.health_goals ?? [];
      return {
        ...prev,
        health_goals: goals.includes(id) ? goals.filter(g => g !== id) : [...goals, id],
      };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    // Resolve height: ft + in → cm. Treat empty strings as "no value".
    let height_cm: number | null = profile.height_cm ?? null;
    const ftN = parseInt(heightFt, 10);
    const inN = parseInt(heightIn, 10);
    if (!isNaN(ftN) || !isNaN(inN)) {
      const totalIn = (isNaN(ftN) ? 0 : ftN) * 12 + (isNaN(inN) ? 0 : inN);
      height_cm = totalIn > 0 ? Math.round(totalIn * 2.54) : null;
    } else if (heightFt === "" && heightIn === "") {
      // Both cleared — explicitly null out so the DB drops the value.
      height_cm = null;
    }
    const payload = { ...profile, height_cm };
    try {
      await api.saveProfile(payload);
      setSaved(true);
      setTimeout(() => { setSaved(false); onClose(); }, 800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const inp = "w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-[#1B3829] focus:ring-1 focus:ring-[#1B3829]/20";

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-50 mx-auto max-w-sm rounded-2xl bg-white shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <p className="font-semibold text-gray-900">
              {tab === "profile" ? "Health Profile" : "Friends"}
            </p>
            <p className="text-xs text-gray-600 mt-0.5">
              {tab === "profile"
                ? "Personalizes your longevity score & AI coaching"
                : "Connect with friends to share activity & compete"}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-600 text-xl leading-none ml-3">✕</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100">
          {(["profile", "friends"] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2.5 text-xs font-semibold transition-colors border-b-2 -mb-px ${
                tab === t
                  ? "text-[#1B3829] border-[#1B3829]"
                  : "text-gray-600 border-transparent hover:text-gray-600"
              }`}
            >
              {t === "profile" ? "👤 Profile" : "🤝 Friends"}
            </button>
          ))}
        </div>

        {/* Body */}
        {tab === "profile" ? (
          loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-7 w-7 rounded-full border-2 border-[#1B3829] border-t-transparent animate-spin" />
            </div>
          ) : (
            <div className="px-5 py-4 space-y-5 max-h-[55vh] overflow-y-auto">

              {/* Display name */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-widest mb-1.5">Display Name</label>
                <input
                  type="text"
                  maxLength={40}
                  placeholder="e.g. David B."
                  className={inp}
                  value={profile.name ?? ""}
                  onChange={e => setProfile(prev => ({ ...prev, name: e.target.value || null }))}
                />
                <p className="text-[10px] text-gray-600 mt-1">
                  What your friends see in their Pulse feed and Friends list.
                </p>
              </div>

              {/* Date of birth (age derives from this and stays current) */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-widest mb-1.5">Date of Birth</label>
                <input
                  type="date"
                  max={localToday()}
                  className={inp}
                  value={profile.birthdate ?? ""}
                  onChange={e => setProfile(prev => ({ ...prev, birthdate: e.target.value || null }))}
                />
                {(() => {
                  let dobAge: number | null = profile.age ?? null;
                  if (profile.birthdate) {
                    const b = new Date(profile.birthdate);
                    const t = new Date();
                    let a = t.getFullYear() - b.getFullYear();
                    const m = t.getMonth() - b.getMonth();
                    if (m < 0 || (m === 0 && t.getDate() < b.getDate())) a--;
                    dobAge = a >= 0 && a <= 130 ? a : null;
                  }
                  return (
                    <p className="text-[10px] text-gray-600 mt-1">
                      {dobAge != null
                        ? `Age ${dobAge} · keeps your HRV norms & longevity score age-accurate automatically.`
                        : "Optional. Used to age-adjust your HRV norms and longevity score — and it stays current as you age."}
                    </p>
                  );
                })()}
              </div>

              {/* Biological sex */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-widest mb-1.5">Biological Sex</label>
                <div className="flex gap-2">
                  {(["male", "female"] as const).map(sex => (
                    <button
                      key={sex}
                      onClick={() => setProfile(prev => ({ ...prev, biological_sex: sex }))}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors border ${
                        profile.biological_sex === sex
                          ? "bg-[#1B3829] text-white border-[#1B3829]"
                          : "bg-gray-50 text-gray-600 border-gray-200 hover:border-gray-400"
                      }`}
                    >
                      {sex === "male" ? "Male" : "Female"}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-gray-600 mt-1">Used for body fat and VO2 max reference ranges.</p>
              </div>

              {/* Height — entered as ft + in for US users, stored as cm
                  on the DB. Feeds BMI calculation in the Annual Physical
                  report and the patient header on every Health Report. */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-widest mb-1.5">Height</label>
                <div className="flex gap-2 items-center">
                  <div className="flex-1">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={3}
                      max={8}
                      placeholder="5"
                      className={inp}
                      value={heightFt}
                      onChange={e => setHeightFt(e.target.value)}
                    />
                  </div>
                  <span className="text-xs text-gray-600 font-medium">ft</span>
                  <div className="flex-1">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={11}
                      placeholder="10"
                      className={inp}
                      value={heightIn}
                      onChange={e => setHeightIn(e.target.value)}
                    />
                  </div>
                  <span className="text-xs text-gray-600 font-medium">in</span>
                </div>
                {profile.height_cm != null && (
                  <p className="text-[10px] text-gray-600 mt-1">
                    Stored as {profile.height_cm} cm · used for BMI on your Annual Physical report.
                  </p>
                )}
              </div>

              {/* Health goals */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-widest mb-1.5">
                  Health Goals <span className="normal-case font-normal text-gray-600">(pick any)</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {GOAL_OPTIONS.map(({ id, label, icon }) => {
                    const selected = (profile.health_goals ?? []).includes(id);
                    return (
                      <button
                        key={id}
                        onClick={() => toggleGoal(id)}
                        className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-left text-xs font-medium transition-colors border ${
                          selected
                            ? "bg-[#1B3829]/8 border-[#1B3829]/40 text-[#1B3829]"
                            : "bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-400"
                        }`}
                        style={selected ? { backgroundColor: "rgba(27,56,41,0.08)", borderColor: "rgba(27,56,41,0.4)" } : undefined}
                      >
                        <span className="text-base leading-none">{icon}</span>
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Training level — feeds today_workout.py's cold-start
                  safety directive so beginner defaults stick even after
                  the user has logged sessions, and advanced unlocks the
                  full compound-lift library. Optional; missing = safe. */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-widest mb-1.5">
                  Training level
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(["beginner", "intermediate", "advanced"] as const).map(lvl => {
                    const selected = profile.training_level === lvl;
                    const emoji = lvl === "beginner" ? "🌱" : lvl === "intermediate" ? "🏃" : "🔥";
                    return (
                      <button
                        key={lvl}
                        onClick={() => setProfile(p => ({ ...p, training_level: selected ? null : lvl }))}
                        className={`flex flex-col items-center gap-1 rounded-xl px-2 py-2.5 text-xs font-medium transition-colors border ${
                          selected
                            ? "bg-[#1B3829]/8 border-[#1B3829]/40 text-[#1B3829]"
                            : "bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-400"
                        }`}
                      >
                        <span className="text-lg leading-none">{emoji}</span>
                        <span className="capitalize">{lvl}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-gray-500 leading-snug mt-1">
                  Beginner sticks to bodyweight + light dumbbell forever. Advanced unlocks the full compound-lift library.
                </p>
              </div>

              {/* Chronic injuries — feeds workout prescription to avoid
                  movements loading these areas. Simple comma-separated
                  entry so we don't overbuild UI. */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-widest mb-1.5">
                  Injuries / areas to protect
                </label>
                <input
                  type="text"
                  value={(profile.chronic_injuries ?? []).map(i => i.area).join(", ")}
                  onChange={e => {
                    const areas = e.target.value.split(",").map(s => s.trim()).filter(Boolean);
                    setProfile(p => ({
                      ...p,
                      chronic_injuries: areas.map(a => ({ area: a })),
                    }));
                  }}
                  placeholder="e.g. right shoulder, lower back, left knee"
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-[#1B3829]"
                />
                <p className="text-[10px] text-gray-500 leading-snug mt-1">
                  Coach Al avoids movements that load these areas when prescribing your daily workout.
                </p>
              </div>

              {error && (
                <p className="text-xs text-red-500 bg-red-50 rounded-xl px-3 py-2">{error}</p>
              )}

              {/* Wearable state controls. Pause Oura is the "I'm taking a
                  break from the ring" switch — mutes the freshness banner
                  without disconnecting. Chris (Whoop user in beta) hit
                  this: former Oura wearer, now on Fitbit + Apple Watch,
                  got the "your data is old" nag on every load. */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-widest">
                  Wearables
                </p>
                <OuraPauseToggle />
              </div>

              {/* Fable Round 2 fix (App Store req + GDPR/CCPA): user-facing
                  data export + account deletion controls. Lives inside a
                  <details> so it doesn't crowd the primary Profile edit
                  workflow — a user who wants it will find it in seconds. */}
              <AccountDangerZone />
            </div>
          )
        ) : (
          <FriendsPanel />
        )}

        {/* Footer — Profile tab only */}
        {tab === "profile" && !loading && (
          <div className="px-5 py-4 border-t border-gray-100 flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:border-gray-400 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 py-2.5 rounded-xl bg-[#1B3829] hover:bg-[#2D6A4F] text-white text-sm font-semibold transition-colors disabled:opacity-50"
            >
              {saved ? "✓ Saved!" : saving ? "Saving…" : "Save Profile"}
            </button>
          </div>
        )}
        {tab === "friends" && (
          <div className="px-5 py-3 border-t border-gray-100">
            <button
              onClick={onClose}
              className="w-full py-2.5 rounded-xl bg-[#1B3829] hover:bg-[#2D6A4F] text-white text-sm font-semibold transition-colors"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </>
  );
}


// ── Friends panel ────────────────────────────────────────────────────────────

function FriendsPanel() {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);

  const [invite,        setInvite]        = useState<FriendInvite | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [copied,        setCopied]        = useState(false);
  // Fable-endorsed demand-signal instrumentation (2026-07-06). Not a
  // family feature — just a tag on the invite row so we can measure
  // "what fraction of invites are spouses vs friends" post-launch.
  const [inviteRelationship, setInviteRelationship] = useState<RelationshipType | "">("");

  const [acceptCode,    setAcceptCode]    = useState("");
  const [accepting,     setAccepting]     = useState(false);
  const [acceptMsg,     setAcceptMsg]     = useState<{ ok: boolean; text: string } | null>(null);

  // Tracks which friend the X is "armed" on. A second tap on the same X
  // within 3 seconds actually removes; otherwise the arm state resets.
  const [removeArmed,   setRemoveArmed]   = useState<string | null>(null);

  const loadFriends = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.friends.list();
      setFriends(res.friends);
    } catch {
      setFriends([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadFriends(); }, [loadFriends]);

  const handleInvite = async () => {
    setInviteLoading(true);
    setCopied(false);
    try {
      const i = await api.friends.invite(
        inviteRelationship === "" ? undefined : inviteRelationship,
      );
      setInvite(i);
    } catch {
      setInvite(null);
    } finally {
      setInviteLoading(false);
    }
  };

  const handleCopy = () => {
    if (!invite) return;
    navigator.clipboard.writeText(invite.code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  const handleAccept = async () => {
    const code = acceptCode.trim().toUpperCase();
    if (code.length < 4) return;
    setAccepting(true);
    setAcceptMsg(null);
    try {
      await api.friends.accept(code);
      setAcceptMsg({ ok: true, text: "✓ Friend added!" });
      setAcceptCode("");
      loadFriends();
    } catch (e) {
      setAcceptMsg({ ok: false, text: e instanceof Error ? e.message : "Invalid or expired code." });
    } finally {
      setAccepting(false);
    }
  };

  const handleRemove = async (friend_user_id: string) => {
    // Two-tap confirmation. First tap arms the button; second tap (within 3s)
    // actually deletes. Prevents accidental friend removal — a single
    // misclick used to wipe the friendship instantly.
    if (removeArmed !== friend_user_id) {
      setRemoveArmed(friend_user_id);
      setTimeout(() => {
        setRemoveArmed(prev => prev === friend_user_id ? null : prev);
      }, 3000);
      return;
    }
    setRemoveArmed(null);
    try {
      await api.friends.remove(friend_user_id);
      setFriends(prev => prev.filter(f => f.user_id !== friend_user_id));
    } catch {}
  };

  const inp = "w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-[#1B3829] focus:ring-1 focus:ring-[#1B3829]/20 uppercase tracking-widest font-mono";

  return (
    <div className="px-5 py-4 space-y-5 max-h-[55vh] overflow-y-auto">

      {/* Friends list */}
      <div>
        <label className="block text-xs font-semibold text-gray-600 uppercase tracking-widest mb-2">
          Your Friends <span className="normal-case font-normal text-gray-600">({friends.length})</span>
        </label>
        {loading ? (
          <p className="text-xs text-gray-600 italic">Loading…</p>
        ) : friends.length === 0 ? (
          <p className="text-xs text-gray-600 italic">No friends yet — invite one below.</p>
        ) : (
          <div className="space-y-1.5">
            {friends.map(f => {
              const armed = removeArmed === f.user_id;
              return (
                <div key={f.user_id} className="flex items-center justify-between rounded-xl bg-gray-50 border border-gray-100 px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-7 h-7 rounded-full bg-[#1B3829] text-white text-xs font-semibold flex items-center justify-center shrink-0">
                      {(f.name || "?").slice(0, 1).toUpperCase()}
                    </span>
                    <p className="text-sm font-medium text-gray-900 truncate">{f.name}</p>
                  </div>
                  <button
                    onClick={() => handleRemove(f.user_id)}
                    className={`text-xs px-2 py-1 rounded-md transition-colors leading-none ${
                      armed
                        ? "bg-red-500 hover:bg-red-600 text-white font-semibold"
                        : "text-gray-500 hover:text-red-400 text-base"
                    }`}
                    title={armed ? "Tap again to confirm removal" : "Remove friend"}
                  >
                    {armed ? "Confirm?" : "✕"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Invite a friend */}
      <div>
        <label className="block text-xs font-semibold text-gray-600 uppercase tracking-widest mb-2">
          Invite a Friend
        </label>
        {!invite ? (
          <div className="space-y-2">
            {/* Optional "how do you know them?" — pure demand-signal
                instrumentation. Skipping it is fine; leaves the tag
                null. Never changes anything downstream today. */}
            <select
              value={inviteRelationship}
              onChange={e => setInviteRelationship(e.target.value as RelationshipType | "")}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-[#1B3829]"
              aria-label="How do you know this person?"
            >
              <option value="">How do you know them? (optional)</option>
              <option value="partner">Partner / spouse</option>
              <option value="parent">Parent</option>
              <option value="adult_child">Adult child</option>
              <option value="sibling">Sibling</option>
              <option value="friend">Friend</option>
              <option value="colleague">Colleague</option>
              <option value="other">Other</option>
            </select>
            <button
              onClick={handleInvite}
              disabled={inviteLoading}
              className="w-full py-2.5 rounded-xl bg-[#1B3829]/8 hover:bg-[#1B3829]/15 text-[#1B3829] text-sm font-semibold transition-colors disabled:opacity-50 border border-[#1B3829]/30"
              style={{ backgroundColor: "rgba(27,56,41,0.08)" }}
            >
              {inviteLoading ? "Generating…" : "Generate invite code"}
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="rounded-xl bg-gradient-to-br from-[#1B3829] to-[#2D6A4F] px-4 py-3 text-white">
              <p className="text-[10px] uppercase tracking-widest text-white/60 mb-1">Share this code</p>
              <div className="flex items-center justify-between gap-2">
                <p className="text-2xl font-mono font-bold tracking-widest">{invite.code}</p>
                <button
                  onClick={handleCopy}
                  className="text-xs bg-white/15 hover:bg-white/25 px-3 py-1.5 rounded-lg font-semibold transition-colors"
                >
                  {copied ? "✓ Copied" : "Copy"}
                </button>
              </div>
              <p className="text-[10px] text-white/60 mt-1.5">
                Expires in 72 hours · Single use
              </p>
            </div>
            <p className="text-[10px] text-gray-600">
              Text or email this code to your friend. They paste it below to connect.
            </p>
            <button
              onClick={handleInvite}
              className="text-[11px] text-gray-600 hover:text-[#1B3829] font-medium"
            >
              Generate a new code
            </button>
          </div>
        )}
      </div>

      {/* Accept a friend code — works for either a one-time invite or a share-link code */}
      <div>
        <label className="block text-xs font-semibold text-gray-600 uppercase tracking-widest mb-2">
          Got a friend code?
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="ABCDEF"
            maxLength={8}
            className={inp}
            value={acceptCode}
            onChange={e => setAcceptCode(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === "Enter" && handleAccept()}
          />
          <button
            onClick={handleAccept}
            disabled={accepting || acceptCode.trim().length < 4}
            className="px-4 py-2.5 rounded-xl bg-[#1B3829] hover:bg-[#2D6A4F] text-white text-sm font-semibold transition-colors disabled:opacity-40"
          >
            {accepting ? "…" : "Accept"}
          </button>
        </div>
        {acceptMsg && (
          <p className={`text-xs mt-2 px-3 py-2 rounded-xl ${
            acceptMsg.ok ? "text-green-700 bg-green-50" : "text-red-500 bg-red-50"
          }`}>
            {acceptMsg.text}
          </p>
        )}
      </div>
    </div>
  );
}


// ── Account Danger Zone — export + delete ───────────────────────────────────
// Fable Round 2 fix (App Store req + GDPR/CCPA). Collapsed by default
// so it doesn't crowd the primary Profile-edit workflow. Export downloads
// the full JSON blob client-side; delete starts a 7-day grace window with
// a Cancel button until the window elapses.

function AccountDangerZone() {
  const [pending, setPending] = useState<{ scheduled_at?: string; grace_days_remaining?: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    api.accountDeletionStatus().then(setPending).catch(() => setPending(null));
  }, []);

  const handleExport = async () => {
    setBusy("export"); setMsg(null);
    try {
      const blob = await api.exportAccount();
      const text = JSON.stringify(blob, null, 2);
      const url  = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const a    = document.createElement("a");
      const stamp = localToday();
      a.href     = url;
      a.download = `backnine-export-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMsg({ ok: true, text: "Export downloaded." });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Export failed — try again in a moment." });
    } finally {
      setBusy(null);
    }
  };

  const handleRequestDelete = async () => {
    setBusy("delete"); setMsg(null);
    try {
      const res = await api.requestAccountDeletion();
      setPending({
        scheduled_at:         res.deletion_scheduled_at,
        grace_days_remaining: res.grace_days,
      });
      setConfirmDelete(false);
      setMsg({ ok: true, text: "Deletion scheduled. You can cancel any time in the next 7 days." });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't schedule deletion — try again." });
    } finally {
      setBusy(null);
    }
  };

  const handleCancelDelete = async () => {
    setBusy("cancel"); setMsg(null);
    try {
      await api.cancelAccountDeletion();
      setPending(null);
      setMsg({ ok: true, text: "Deletion canceled. Your account is safe." });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't cancel — try again." });
    } finally {
      setBusy(null);
    }
  };

  const hasPending = pending && pending.scheduled_at;

  return (
    <details className="rounded-xl border border-gray-200 bg-gray-50/60 px-3 py-2 mt-2">
      <summary className="cursor-pointer text-xs font-semibold uppercase tracking-widest text-gray-600 select-none">
        Account & data
      </summary>

      <div className="mt-3 space-y-3">
        {hasPending && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
            <p className="text-[12px] text-amber-900 font-semibold">
              Deletion scheduled for {new Date(pending!.scheduled_at as string).toLocaleDateString()}
              {pending!.grace_days_remaining != null && (
                <> — {Math.max(0, Math.round(pending!.grace_days_remaining))} days remaining</>
              )}
            </p>
            <button
              onClick={handleCancelDelete}
              disabled={busy === "cancel"}
              className="mt-1.5 text-[11px] font-semibold text-amber-800 underline disabled:opacity-40"
            >
              {busy === "cancel" ? "Canceling…" : "Cancel deletion"}
            </button>
          </div>
        )}

        <div className="space-y-1.5">
          <p className="text-[11px] text-gray-600 leading-snug">
            Download all your data — meals, workouts, sleep, labs, journal, chat history — as JSON.
          </p>
          <button
            onClick={handleExport}
            disabled={busy === "export"}
            className="text-[12px] font-semibold px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:border-gray-500 hover:text-gray-900 disabled:opacity-40 transition-colors"
          >
            {busy === "export" ? "Preparing…" : "Export my data"}
          </button>
        </div>

        {!hasPending && (
          <div className="space-y-1.5 pt-2 border-t border-gray-200">
            <p className="text-[11px] text-gray-600 leading-snug">
              Delete your account. You&rsquo;ll have a 7-day grace window to cancel before your data is permanently removed.
            </p>
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                className="text-[12px] font-semibold px-3 py-1.5 rounded-lg border border-red-200 text-red-700 hover:border-red-400 hover:bg-red-50 transition-colors"
              >
                Delete my account
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleRequestDelete}
                  disabled={busy === "delete"}
                  className="text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white disabled:opacity-40 transition-colors"
                >
                  {busy === "delete" ? "Scheduling…" : "Confirm — start 7-day countdown"}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="text-[12px] font-medium text-gray-600 hover:text-gray-900"
                >
                  Never mind
                </button>
              </div>
            )}
          </div>
        )}

        {msg && (
          <p className={`text-[11px] px-2 py-1 rounded-lg ${
            msg.ok ? "text-emerald-800 bg-emerald-50" : "text-red-700 bg-red-50"
          }`}>
            {msg.text}
          </p>
        )}
      </div>
    </details>
  );
}
