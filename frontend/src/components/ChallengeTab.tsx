"use client";

import { useEffect, useState, useCallback } from "react";
import { api, type Challenge, type ChallengeParticipant } from "@/lib/api";

// ── Helpers ───────────────────────────────────────────────────────────────────
const TYPE_OPTIONS = [
  { value: "steps",    label: "Daily Steps",    unit: "steps", icon: "👟", placeholder: "e.g. 10000" },
  { value: "calories", label: "Calorie Burn",   unit: "kcal",  icon: "🔥", placeholder: "e.g. 600"   },
  { value: "protein",  label: "Protein Goal",   unit: "g",     icon: "💪", placeholder: "e.g. 150"   },
  { value: "custom",   label: "Custom Goal",    unit: "pts",   icon: "🎯", placeholder: "e.g. 1"     },
];

const DURATION_OPTIONS = [7, 14, 21, 30];

function pct(value: number, target: number) {
  return Math.min(100, Math.round((value / Math.max(target, 1)) * 100));
}

function daysLabel(n: number) {
  return n === 1 ? "1 day" : `${n} days`;
}

// ── Progress ring ─────────────────────────────────────────────────────────────
function ProgressRing({ value, target, color }: { value: number; target: number; color: string }) {
  const r    = 28;
  const circ = 2 * Math.PI * r;
  const p    = pct(value, target);
  return (
    <div className="relative w-16 h-16 flex-shrink-0">
      <svg viewBox="0 0 64 64" className="w-full h-full -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="#E5E7EB" strokeWidth="7" />
        <circle
          cx="32" cy="32" r={r} fill="none"
          stroke={p >= 100 ? "#22c55e" : color}
          strokeWidth="7" strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - p / 100)}
          className="transition-all duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-xs font-bold text-gray-800">{p}%</span>
      </div>
    </div>
  );
}

// ── Participant row ───────────────────────────────────────────────────────────
function ParticipantRow({
  p, target, metric, rank, color,
}: {
  p: ChallengeParticipant; target: number; metric: string; rank: number; color: string;
}) {
  const rankEmoji = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`;
  const barPct = pct(p.today_value, target);
  return (
    <div className={`rounded-xl p-3 ${p.is_me ? "bg-gray-100 border border-gray-300" : "bg-gray-50"}`}>
      <div className="flex items-center gap-3">
        <span className="text-lg w-7 text-center flex-shrink-0">{rankEmoji}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm font-semibold text-gray-900 truncate">
              {p.display_name}
              {p.is_me && <span className="ml-1.5 text-xs text-gray-400 font-normal">(you)</span>}
            </p>
            <p className="text-sm font-bold flex-shrink-0 ml-2" style={{ color }}>
              {p.today_value.toLocaleString()} <span className="text-xs font-normal text-gray-400">{metric}</span>
            </p>
          </div>
          {/* Today's bar */}
          <div className="h-1.5 rounded-full bg-gray-200 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${barPct}%`, backgroundColor: barPct >= 100 ? "#22c55e" : color }}
            />
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-xs text-gray-400">{p.days_hit} days hit · {p.streak}🔥 streak</span>
            <span className="text-xs text-gray-400">{p.total_value.toLocaleString()} total</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Challenge card ────────────────────────────────────────────────────────────
const COLORS = ["#6366f1", "#f59e0b", "#ec4899", "#22c55e", "#06b6d4", "#f97316"];

function ChallengeCard({
  challenge, onRefresh, onLog,
}: {
  challenge: Challenge;
  onRefresh: (id: string) => Promise<void>;
  onLog: (challenge: Challenge) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(challenge.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await onRefresh(challenge.id);
    setRefreshing(false);
  };

  const progressPct = challenge.elapsed_days > 0
    ? Math.round((challenge.elapsed_days / challenge.total_days) * 100)
    : 0;

  const me = challenge.participants.find(p => p.is_me);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-lg">{challenge.type_info.icon}</span>
              <p className="text-sm font-bold text-gray-900 truncate">{challenge.name}</p>
              {!challenge.is_active && (
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-gray-200 text-gray-500 flex-shrink-0">Ended</span>
              )}
            </div>
            <p className="text-xs text-gray-400">
              {challenge.target.toLocaleString()} {challenge.metric}/day · {daysLabel(challenge.total_days)}
            </p>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 text-xs font-mono font-semibold bg-gray-100 hover:bg-gray-200 text-gray-700 px-2 py-1 rounded-lg transition-colors"
              title="Copy invite code"
            >
              {copied ? "✓ Copied" : challenge.id}
            </button>
            <button
              onClick={handleRefresh}
              className="text-gray-400 hover:text-gray-700 transition-colors px-1"
              title="Refresh"
            >
              {refreshing ? "⟳" : "↻"}
            </button>
          </div>
        </div>

        {/* Time progress bar */}
        <div className="mt-3">
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span>Day {challenge.elapsed_days} of {challenge.total_days}</span>
            <span>{daysLabel(challenge.days_left)} left</span>
          </div>
          <div className="h-1 rounded-full bg-gray-100">
            <div
              className="h-full rounded-full bg-zinc-600 transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Leaderboard */}
      <div className="px-4 pb-3 space-y-2">
        {challenge.participants.map((p, i) => (
          <ParticipantRow
            key={p.user_id}
            p={p}
            target={challenge.target}
            metric={challenge.metric}
            rank={i + 1}
            color={COLORS[i % COLORS.length]}
          />
        ))}
      </div>

      {/* Log progress button */}
      {challenge.is_active && (
        <div className="px-4 pb-4">
          <button
            onClick={() => onLog(challenge)}
            className="w-full py-2.5 rounded-xl bg-[#1B3829] hover:bg-[#2D6A4F] text-white text-sm font-semibold transition-colors"
          >
            + Log today's {challenge.type_info.label.toLowerCase()}
          </button>
          {me && me.today_value > 0 && (
            <p className="text-xs text-center text-gray-400 mt-1.5">
              Logged today: {me.today_value.toLocaleString()} {challenge.metric}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Create form ───────────────────────────────────────────────────────────────
function CreateChallengeForm({
  onCreated, onCancel,
}: {
  onCreated: (c: Challenge) => void;
  onCancel: () => void;
}) {
  const [type, setType]           = useState("steps");
  const [name, setName]           = useState("");
  const [target, setTarget]       = useState("");
  const [duration, setDuration]   = useState(7);
  const [myName, setMyName]       = useState("");
  const [customUnit, setCustomUnit] = useState("");
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const typeOpt = TYPE_OPTIONS.find(t => t.value === type)!;

  const handleCreate = async () => {
    if (!name.trim() || !target || !myName.trim()) {
      setError("Fill in all fields.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const c = await api.createChallenge({
        name: name.trim(),
        type,
        target: parseFloat(target),
        duration_days: duration,
        creator_name: myName.trim(),
        custom_unit: type === "custom" ? customUnit.trim() || "pts" : undefined,
      });
      onCreated(c);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create challenge");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-gray-900">New Challenge</p>
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
      </div>

      {/* Type selector */}
      <div>
        <label className="block text-xs text-gray-500 mb-2">Challenge type</label>
        <div className="grid grid-cols-2 gap-2">
          {TYPE_OPTIONS.map(t => (
            <button key={t.value} onClick={() => setType(t.value)}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-all ${
                type === t.value
                  ? "border-indigo-500/60 bg-indigo-500/20 text-indigo-300"
                  : "border-gray-300 text-gray-500 hover:text-gray-800"
              }`}>
              <span>{t.icon}</span><span>{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Name */}
      <div>
        <label className="block text-xs text-gray-500 mb-1">Challenge name</label>
        <input
          type="text" value={name} onChange={e => setName(e.target.value)}
          placeholder={`e.g. April ${typeOpt.label} Battle`}
          className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#1B3829]"
        />
      </div>

      {/* Daily target */}
      <div>
        <label className="block text-xs text-gray-500 mb-1">
          Daily target ({type === "custom" ? (customUnit || "pts") : typeOpt.unit})
        </label>
        <input
          type="number" value={target} onChange={e => setTarget(e.target.value)}
          placeholder={typeOpt.placeholder}
          className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#1B3829]"
        />
      </div>

      {/* Custom unit */}
      {type === "custom" && (
        <div>
          <label className="block text-xs text-gray-500 mb-1">Unit label (optional)</label>
          <input
            type="text" value={customUnit} onChange={e => setCustomUnit(e.target.value)}
            placeholder="e.g. miles, sessions, pages"
            className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#1B3829]"
          />
        </div>
      )}

      {/* Duration */}
      <div>
        <label className="block text-xs text-gray-500 mb-2">Duration</label>
        <div className="flex gap-2">
          {DURATION_OPTIONS.map(d => (
            <button key={d} onClick={() => setDuration(d)}
              className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-all ${
                duration === d
                  ? "border-indigo-500/60 bg-indigo-500/20 text-indigo-300"
                  : "border-gray-300 text-gray-500 hover:text-gray-800"
              }`}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Display name */}
      <div>
        <label className="block text-xs text-gray-500 mb-1">Your display name</label>
        <input
          type="text" value={myName} onChange={e => setMyName(e.target.value)}
          placeholder="e.g. David"
          className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#1B3829]"
        />
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <button onClick={handleCreate} disabled={saving}
        className="w-full py-2.5 rounded-xl bg-[#1B3829] hover:bg-[#2D6A4F] text-white text-sm font-semibold disabled:opacity-50 transition-colors">
        {saving ? "Creating…" : "🚀 Create & get invite code"}
      </button>
    </div>
  );
}

// ── Join form ─────────────────────────────────────────────────────────────────
function JoinChallengeForm({
  onJoined, onCancel,
}: {
  onJoined: (c: Challenge) => void;
  onCancel: () => void;
}) {
  const [code, setCode]     = useState("");
  const [myName, setMyName] = useState("");
  const [joining, setJoining] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  const handleJoin = async () => {
    if (!code.trim() || !myName.trim()) { setError("Enter the code and your name."); return; }
    setJoining(true);
    setError(null);
    try {
      const c = await api.joinChallenge(code.trim().toUpperCase(), myName.trim());
      onJoined(c);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Challenge not found");
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-gray-900">Join a Challenge</p>
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Invite code</label>
        <input
          type="text" value={code} onChange={e => setCode(e.target.value.toUpperCase())}
          placeholder="e.g. K7XRMB"
          className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 font-mono tracking-widest placeholder-gray-400 focus:outline-none focus:border-[#1B3829]"
          maxLength={8}
        />
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Your display name</label>
        <input
          type="text" value={myName} onChange={e => setMyName(e.target.value)}
          placeholder="e.g. Mike"
          className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#1B3829]"
        />
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <button onClick={handleJoin} disabled={joining}
        className="w-full py-2.5 rounded-xl bg-[#1B3829] hover:bg-[#2D6A4F] text-white text-sm font-semibold disabled:opacity-50 transition-colors">
        {joining ? "Joining…" : "Join Challenge"}
      </button>
    </div>
  );
}

// ── Log progress modal ────────────────────────────────────────────────────────
function LogProgressModal({
  challenge, onSaved, onCancel,
}: {
  challenge: Challenge;
  onSaved: (c: Challenge) => void;
  onCancel: () => void;
}) {
  const me    = challenge.participants.find(p => p.is_me);
  const today = new Date().toISOString().slice(0, 10);
  const [value, setValue] = useState(String(me?.today_value || ""));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await api.logChallengeProgress(challenge.id, parseFloat(value));
      onSaved(updated);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold text-gray-900">Log {challenge.type_info.icon} {challenge.type_info.label}</p>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>

        <p className="text-xs text-gray-400">For {today} · target: {challenge.target.toLocaleString()} {challenge.metric}</p>

        <div>
          <label className="block text-xs text-gray-500 mb-1">
            Your {challenge.metric} today
          </label>
          <input
            type="number" step="any"
            value={value} onChange={e => setValue(e.target.value)}
            autoFocus
            className="w-full bg-white border border-gray-200 rounded-lg px-3 py-3 text-xl font-bold text-gray-900 text-center focus:outline-none focus:border-[#1B3829]"
          />
        </div>

        <div className="flex gap-2">
          <button onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl border border-gray-300 text-gray-500 text-sm font-medium transition-colors hover:text-gray-900 hover:border-gray-400">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving || !value}
            className="flex-1 py-2.5 rounded-xl bg-[#1B3829] hover:bg-[#2D6A4F] text-white text-sm font-semibold disabled:opacity-50 transition-colors">
            {saving ? "Saving…" : "Log it"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main ChallengeTab ─────────────────────────────────────────────────────────
type View = "list" | "create" | "join";

export default function ChallengeTab() {
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [loading, setLoading]       = useState(true);
  const [view, setView]             = useState<View>("list");
  const [logTarget, setLogTarget]   = useState<Challenge | null>(null);

  const load = useCallback(async () => {
    try {
      const { challenges: cs } = await api.myChallenges();
      setChallenges(cs);
    } catch (err) {
      console.error("Challenges load error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRefresh = async (id: string) => {
    try {
      const updated = await api.getChallenge(id);
      setChallenges(prev => prev.map(c => c.id === id ? updated : c));
    } catch {}
  };

  const handleCreatedOrJoined = (c: Challenge) => {
    setChallenges(prev => {
      const exists = prev.some(x => x.id === c.id);
      return exists ? prev.map(x => x.id === c.id ? c : x) : [c, ...prev];
    });
    setView("list");
  };

  const handleLogged = (updated: Challenge) => {
    setChallenges(prev => prev.map(c => c.id === updated.id ? updated : c));
    setLogTarget(null);
  };

  if (loading) {
    return <div className="text-center py-16 text-gray-400 text-sm">Loading challenges…</div>;
  }

  return (
    <div className="space-y-4">
      {/* Log modal */}
      {logTarget && (
        <LogProgressModal
          challenge={logTarget}
          onSaved={handleLogged}
          onCancel={() => setLogTarget(null)}
        />
      )}

      {/* Create / Join forms */}
      {view === "create" && (
        <CreateChallengeForm
          onCreated={handleCreatedOrJoined}
          onCancel={() => setView("list")}
        />
      )}
      {view === "join" && (
        <JoinChallengeForm
          onJoined={handleCreatedOrJoined}
          onCancel={() => setView("list")}
        />
      )}

      {/* Action buttons */}
      {view === "list" && (
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setView("create")}
            className="flex items-center justify-center gap-2 py-3 rounded-xl bg-[#1B3829] text-white hover:bg-[#2D6A4F] text-sm font-medium transition-all"
          >
            🚀 New challenge
          </button>
          <button
            onClick={() => setView("join")}
            className="flex items-center justify-center gap-2 py-3 rounded-xl border border-gray-200 bg-white text-gray-600 hover:text-gray-900 hover:border-gray-300 text-sm font-medium transition-all"
          >
            🔗 Join with code
          </button>
        </div>
      )}

      {/* Challenge list */}
      {view === "list" && (
        challenges.length === 0 ? (
          <div className="text-center py-14 space-y-2">
            <p className="text-3xl">🏆</p>
            <p className="text-gray-500 text-sm font-medium">No challenges yet</p>
            <p className="text-gray-400 text-xs">Create one and share the code with a friend</p>
          </div>
        ) : (
          <div className="space-y-4">
            {challenges.map(c => (
              <ChallengeCard
                key={c.id}
                challenge={c}
                onRefresh={handleRefresh}
                onLog={setLogTarget}
              />
            ))}
          </div>
        )
      )}
    </div>
  );
}
