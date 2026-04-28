"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { api, type Challenge, type ChallengeParticipant, type ChallengeMessage } from "@/lib/api";

// ── Constants ─────────────────────────────────────────────────────────────────
const TYPE_OPTIONS = [
  { value: "steps",    label: "Daily Steps",  unit: "steps", icon: "👟", placeholder: "e.g. 10000" },
  { value: "calories", label: "Calorie Burn", unit: "kcal",  icon: "🔥", placeholder: "e.g. 600"   },
  { value: "protein",  label: "Protein Goal", unit: "g",     icon: "💪", placeholder: "e.g. 150"   },
  { value: "custom",   label: "Custom Goal",  unit: "pts",   icon: "🎯", placeholder: "e.g. 1"     },
];

const DURATION_OPTIONS = [7, 14, 21, 30];

const PARTICIPANT_COLORS = [
  "#6366f1", "#f59e0b", "#ec4899", "#22c55e", "#06b6d4", "#f97316",
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function pct(value: number, target: number) {
  return Math.min(100, Math.round((value / Math.max(target, 1)) * 100));
}

function daysLabel(n: number) {
  return n === 1 ? "1 day" : `${n} days`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Generate every date string from start to end inclusive */
function dateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const cur = new Date(start + "T12:00:00Z");
  const fin = new Date(end   + "T12:00:00Z");
  while (cur <= fin) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

/** Color for a calendar cell based on % of target */
function cellColor(value: number | undefined, target: number, isFuture: boolean, isToday: boolean) {
  if (isFuture)                     return { bg: "#F9FAFB", border: "#E5E7EB" };
  if (!value || value === 0)        return { bg: "#FEE2E2", border: "#FECACA" };
  const p = value / target;
  if (p >= 1)  return { bg: "#DCFCE7", border: "#86EFAC" };
  if (p >= 0.5) return { bg: "#FEF9C3", border: "#FDE047" };
  return { bg: "#FFE4E6", border: "#FCA5A5" };
}

function fmt(val: number, unit: string) {
  if (unit === "steps") return val.toLocaleString();
  return String(Math.round(val));
}

// ── Calendar grid ─────────────────────────────────────────────────────────────
function ChallengeCalendar({
  challenge,
}: {
  challenge: Challenge;
}) {
  const dates = dateRange(challenge.start_date, challenge.end_date);
  const todayStr = today();
  // Sorted participants: most days_hit first, then total_value
  const sorted = [...challenge.participants].sort(
    (a, b) => b.days_hit - a.days_hit || b.total_value - a.total_value
  );

  // For long challenges compress cell size
  const cellSize = dates.length <= 7 ? 34 : dates.length <= 14 ? 26 : dates.length <= 21 ? 20 : 16;
  const gap = dates.length <= 14 ? 3 : 2;

  return (
    <div className="mt-3 overflow-x-auto pb-1">
      <div style={{ minWidth: dates.length * (cellSize + gap) + 72 }}>
        {/* Date header */}
        <div className="flex mb-1" style={{ gap }}>
          <div style={{ width: 64, flexShrink: 0 }} />
          {dates.map((d, i) => {
            const isT = d === todayStr;
            const dayNum = new Date(d + "T12:00:00Z").getUTCDate();
            return (
              <div
                key={d}
                style={{ width: cellSize, flexShrink: 0, textAlign: "center" }}
                className={`text-[9px] font-semibold ${isT ? "text-[#1B3829]" : "text-gray-300"}`}
              >
                {dayNum}
              </div>
            );
          })}
        </div>

        {/* Participant rows */}
        {sorted.map((p, pi) => (
          <div key={p.user_id} className="flex items-center mb-1.5" style={{ gap }}>
            {/* Name */}
            <div
              style={{ width: 64, flexShrink: 0 }}
              className="text-[11px] text-gray-600 truncate pr-1 text-right font-medium"
            >
              {p.display_name.split(" ")[0]}
              {p.is_me && <span className="text-gray-300 ml-0.5">•</span>}
            </div>

            {/* Day cells */}
            {dates.map((d) => {
              const isFuture = d > todayStr;
              const isT      = d === todayStr;
              const val      = p.daily[d];
              const colors   = cellColor(val, challenge.target, isFuture, isT);
              const hitPct   = val ? Math.min(100, Math.round((val / challenge.target) * 100)) : 0;

              return (
                <div
                  key={d}
                  title={
                    isFuture ? d
                    : val ? `${d}: ${fmt(val, challenge.metric)} ${challenge.metric} (${hitPct}%)`
                    : `${d}: no data`
                  }
                  style={{
                    width: cellSize,
                    height: cellSize,
                    flexShrink: 0,
                    backgroundColor: colors.bg,
                    borderRadius: 4,
                    border: isT
                      ? `2px solid #1B3829`
                      : `1px solid ${colors.border}`,
                    position: "relative",
                    overflow: "hidden",
                  }}
                >
                  {/* Fill bar for partial progress */}
                  {!isFuture && val && hitPct < 100 && (
                    <div
                      style={{
                        position: "absolute",
                        bottom: 0,
                        left: 0,
                        right: 0,
                        height: `${hitPct}%`,
                        backgroundColor: PARTICIPANT_COLORS[pi % PARTICIPANT_COLORS.length] + "33",
                      }}
                    />
                  )}
                  {/* Checkmark for completed */}
                  {!isFuture && val && hitPct >= 100 && cellSize >= 20 && (
                    <div className="absolute inset-0 flex items-center justify-center text-green-500"
                      style={{ fontSize: cellSize < 26 ? 8 : 11 }}>✓</div>
                  )}
                </div>
              );
            })}
          </div>
        ))}

        {/* Legend */}
        <div className="flex items-center gap-3 mt-2 pl-16">
          {[
            { bg: "#DCFCE7", border: "#86EFAC", label: "Hit" },
            { bg: "#FEF9C3", border: "#FDE047", label: "Partial" },
            { bg: "#FEE2E2", border: "#FECACA", label: "Missed" },
            { bg: "#F9FAFB", border: "#E5E7EB", label: "Upcoming" },
          ].map(l => (
            <div key={l.label} className="flex items-center gap-1">
              <div style={{ width: 10, height: 10, backgroundColor: l.bg, border: `1px solid ${l.border}`, borderRadius: 2 }} />
              <span className="text-[9px] text-gray-400">{l.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Leaderboard row (total progress) ─────────────────────────────────────────
function LeaderboardRow({
  p, rank, target, totalDays, metric, color,
}: {
  p: ChallengeParticipant; rank: number; target: number; totalDays: number; metric: string; color: string;
}) {
  const rankEmoji = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`;
  const completionPct = totalDays > 0 ? Math.round((p.days_hit / totalDays) * 100) : 0;

  return (
    <div className={`rounded-xl p-3 ${p.is_me ? "bg-[#1B3829]/5 border border-[#1B3829]/20" : "bg-gray-50"}`}>
      <div className="flex items-center gap-3">
        <span className="text-lg w-7 text-center flex-shrink-0">{rankEmoji}</span>
        <div className="flex-1 min-w-0">
          {/* Name + streak + today badge */}
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <p className="text-sm font-semibold text-gray-900 truncate">
              {p.display_name}
              {p.is_me && <span className="ml-1 text-xs text-gray-400 font-normal">(you)</span>}
            </p>
            {p.streak > 1 && (
              <span className="text-xs text-orange-500 font-medium">{p.streak}🔥</span>
            )}
            {p.today_value > 0 && (
              <span className="text-[10px] bg-green-50 text-green-700 px-1.5 py-0.5 rounded-full font-medium">
                Today: {fmt(p.today_value, metric)}
              </span>
            )}
          </div>

          {/* Days-hit progress bar */}
          <div className="flex items-center gap-2">
            <div className="flex-1 h-2 rounded-full bg-gray-200 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${completionPct}%`,
                  backgroundColor: completionPct >= 80 ? "#22c55e" : completionPct >= 50 ? "#f59e0b" : color,
                }}
              />
            </div>
            <span className="text-xs font-semibold text-gray-700 flex-shrink-0 w-14 text-right">
              {p.days_hit}/{totalDays} days
            </span>
          </div>

          {/* Total value */}
          <p className="text-xs text-gray-400 mt-1">
            {fmt(p.total_value, metric)} {metric} total
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Challenge chat ────────────────────────────────────────────────────────────
const QUICK_REACTIONS = [
  { emoji: "🔥", text: "Let's go! 🔥" },
  { emoji: "💪", text: "Crush it! 💪" },
  { emoji: "😤", text: "I'm catching up 😤" },
  { emoji: "🐌", text: "Someone's slacking... 🐌" },
];

function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function ChallengeChat({ challengeId, myDisplayName }: { challengeId: string; myDisplayName: string }) {
  const [messages, setMessages] = useState<ChallengeMessage[]>([]);
  const [text, setText]         = useState("");
  const [sending, setSending]   = useState(false);
  const [open, setOpen]         = useState(false);
  const bottomRef               = useRef<HTMLDivElement>(null);
  const pollRef                 = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const { messages: msgs } = await api.getChallengeMessages(challengeId);
      setMessages(msgs);
    } catch {}
  }, [challengeId]);

  // Load messages when chat is opened; poll every 8s while open
  useEffect(() => {
    if (!open) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    load();
    pollRef.current = setInterval(load, 8000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [open, load]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  const send = async (msgText: string) => {
    const t = msgText.trim();
    if (!t || sending) return;
    setSending(true);
    try {
      const msg = await api.postChallengeMessage(challengeId, t, myDisplayName);
      setMessages(prev => [...prev, msg]);
      setText("");
    } catch {}
    finally { setSending(false); }
  };

  const unread = messages.length;

  return (
    <div className="border-t border-gray-100">
      {/* Toggle button */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-xs text-gray-500 hover:text-gray-800 hover:bg-gray-50 transition-colors"
      >
        <span className="flex items-center gap-1.5 font-semibold">
          💬 Chat
          {!open && unread > 0 && (
            <span className="bg-[#1B3829] text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">{unread}</span>
          )}
        </span>
        <span className="text-gray-400">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          {/* Message list */}
          <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
            {messages.length === 0 && (
              <p className="text-center text-xs text-gray-400 py-4">No messages yet — be the first to talk trash 😤</p>
            )}
            {messages.map(m => (
              <div key={m.id} className={`flex flex-col ${m.display_name === myDisplayName ? "items-end" : "items-start"}`}>
                <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                  m.display_name === myDisplayName
                    ? "bg-[#1B3829] text-white rounded-br-sm"
                    : "bg-gray-100 text-gray-800 rounded-bl-sm"
                }`}>
                  {m.text}
                </div>
                <p className="text-[9px] text-gray-400 mt-0.5 px-1">
                  {m.display_name === myDisplayName ? "You" : m.display_name} · {fmtTime(m.created_at)}
                </p>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Quick reactions */}
          <div className="flex flex-wrap gap-1.5">
            {QUICK_REACTIONS.map(r => (
              <button
                key={r.emoji}
                onClick={() => send(r.text)}
                disabled={sending}
                className="text-lg hover:scale-110 transition-transform disabled:opacity-40"
                title={r.text}
              >
                {r.emoji}
              </button>
            ))}
          </div>

          {/* Free text input */}
          <div className="flex gap-2">
            <input
              type="text"
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => e.key === "Enter" && send(text)}
              placeholder="Talk some trash…"
              maxLength={200}
              className="flex-1 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#1B3829]"
            />
            <button
              onClick={() => send(text)}
              disabled={sending || !text.trim()}
              className="rounded-xl bg-[#1B3829] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 hover:bg-[#2D6A4F] transition-colors"
            >
              {sending ? "…" : "Send"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Challenge card ────────────────────────────────────────────────────────────
function ChallengeCard({
  challenge, onRefresh, onLog,
}: {
  challenge: Challenge;
  onRefresh: (id: string) => Promise<void>;
  onLog: (c: Challenge) => void;
}) {
  const [copied, setCopied]       = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded]   = useState(true);

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

  const timePct = challenge.total_days > 0
    ? Math.round((challenge.elapsed_days / challenge.total_days) * 100)
    : 0;

  // Sort by days_hit desc, then total_value desc
  const sorted = [...challenge.participants].sort(
    (a, b) => b.days_hit - a.days_hit || b.total_value - a.total_value
  );

  const me = challenge.participants.find(p => p.is_me);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden shadow-sm">

      {/* ── Header ── */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
              <span className="text-xl">{challenge.type_info.icon}</span>
              <p className="text-base font-bold text-gray-900 truncate">{challenge.name}</p>
              {!challenge.is_active && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 flex-shrink-0">Ended</span>
              )}
            </div>
            <p className="text-xs text-gray-400">
              {challenge.target.toLocaleString()} {challenge.metric}/day · {challenge.start_date} → {challenge.end_date}
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
              className={`text-gray-400 hover:text-gray-700 px-1 transition-all ${refreshing ? "animate-spin" : ""}`}
              title="Refresh"
            >
              ↻
            </button>
          </div>
        </div>

        {/* Time progress */}
        <div className="mt-3">
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span className="font-medium text-gray-600">Day {challenge.elapsed_days} of {challenge.total_days}</span>
            <span>{challenge.is_active ? `${daysLabel(challenge.days_left)} left` : "Complete"}</span>
          </div>
          <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${timePct}%`, backgroundColor: challenge.is_active ? "#1B3829" : "#22c55e" }}
            />
          </div>
        </div>
      </div>

      {/* ── Leaderboard ── */}
      <div className="px-4 pb-3 space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-1">Leaderboard</p>
        {sorted.map((p, i) => (
          <LeaderboardRow
            key={p.user_id}
            p={p}
            rank={i + 1}
            target={challenge.target}
            totalDays={challenge.elapsed_days}
            metric={challenge.metric}
            color={PARTICIPANT_COLORS[i % PARTICIPANT_COLORS.length]}
          />
        ))}
      </div>

      {/* ── Calendar toggle ── */}
      <div className="px-4 pb-2">
        <button
          onClick={() => setExpanded(v => !v)}
          className="w-full flex items-center justify-between py-2 text-xs text-gray-400 hover:text-gray-700 transition-colors"
        >
          <span className="font-semibold uppercase tracking-widest">Full Calendar</span>
          <span className="text-base leading-none">{expanded ? "▲" : "▼"}</span>
        </button>
        {expanded && <ChallengeCalendar challenge={challenge} />}
      </div>

      {/* ── Log button ── */}
      {challenge.is_active && (
        <div className="px-4 pb-4 pt-1">
          <button
            onClick={() => onLog(challenge)}
            className="w-full py-2.5 rounded-xl bg-[#1B3829] hover:bg-[#2D6A4F] text-white text-sm font-semibold transition-colors"
          >
            + Log today's {challenge.type_info.label.toLowerCase()}
          </button>
          {me && me.today_value > 0 && (
            <p className="text-xs text-center text-gray-400 mt-1.5">
              Today: {fmt(me.today_value, challenge.metric)} {challenge.metric}
              {pct(me.today_value, challenge.target) >= 100 ? " ✓" : ` · ${pct(me.today_value, challenge.target)}% of target`}
            </p>
          )}
        </div>
      )}

      {/* ── Chat ── */}
      <ChallengeChat
        challengeId={challenge.id}
        myDisplayName={me?.display_name ?? "You"}
      />
    </div>
  );
}

// ── Create form ───────────────────────────────────────────────────────────────
function CreateChallengeForm({ onCreated, onCancel }: { onCreated: (c: Challenge) => void; onCancel: () => void }) {
  const [type, setType]             = useState("steps");
  const [name, setName]             = useState("");
  const [target, setTarget]         = useState("");
  const [duration, setDuration]     = useState(7);
  const [myName, setMyName]         = useState("");
  const [customUnit, setCustomUnit] = useState("");
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState<string | null>(null);

  const typeOpt = TYPE_OPTIONS.find(t => t.value === type)!;

  const handleCreate = async () => {
    if (!name.trim() || !target || !myName.trim()) { setError("Fill in all fields."); return; }
    setSaving(true); setError(null);
    try {
      const c = await api.createChallenge({
        name: name.trim(), type, target: parseFloat(target),
        duration_days: duration, creator_name: myName.trim(),
        custom_unit: type === "custom" ? customUnit.trim() || "pts" : undefined,
      });
      onCreated(c);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create challenge");
    } finally { setSaving(false); }
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-gray-900">New Challenge</p>
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-2">Challenge type</label>
        <div className="grid grid-cols-2 gap-2">
          {TYPE_OPTIONS.map(t => (
            <button key={t.value} onClick={() => setType(t.value)}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-all ${
                type === t.value ? "border-[#1B3829]/40 bg-[#1B3829]/10 text-[#1B3829]" : "border-gray-200 text-gray-500 hover:text-gray-800"
              }`}>
              <span>{t.icon}</span><span>{t.label}</span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Challenge name</label>
        <input type="text" value={name} onChange={e => setName(e.target.value)}
          placeholder={`e.g. May ${typeOpt.label} Battle`}
          className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#1B3829]" />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Daily target ({type === "custom" ? (customUnit || "pts") : typeOpt.unit})</label>
        <input type="number" value={target} onChange={e => setTarget(e.target.value)}
          placeholder={typeOpt.placeholder}
          className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#1B3829]" />
      </div>
      {type === "custom" && (
        <div>
          <label className="block text-xs text-gray-500 mb-1">Unit label</label>
          <input type="text" value={customUnit} onChange={e => setCustomUnit(e.target.value)}
            placeholder="e.g. miles, sessions"
            className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#1B3829]" />
        </div>
      )}
      <div>
        <label className="block text-xs text-gray-500 mb-2">Duration</label>
        <div className="flex gap-2">
          {DURATION_OPTIONS.map(d => (
            <button key={d} onClick={() => setDuration(d)}
              className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-all ${
                duration === d ? "border-[#1B3829]/40 bg-[#1B3829]/10 text-[#1B3829]" : "border-gray-200 text-gray-500 hover:text-gray-800"
              }`}>
              {d}d
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Your display name</label>
        <input type="text" value={myName} onChange={e => setMyName(e.target.value)}
          placeholder="e.g. David"
          className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#1B3829]" />
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
function JoinChallengeForm({ onJoined, onCancel }: { onJoined: (c: Challenge) => void; onCancel: () => void }) {
  const [code, setCode]       = useState("");
  const [myName, setMyName]   = useState("");
  const [joining, setJoining] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const handleJoin = async () => {
    if (!code.trim() || !myName.trim()) { setError("Enter the code and your name."); return; }
    setJoining(true); setError(null);
    try {
      const c = await api.joinChallenge(code.trim().toUpperCase(), myName.trim());
      onJoined(c);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Challenge not found");
    } finally { setJoining(false); }
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-gray-900">Join a Challenge</p>
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Invite code</label>
        <input type="text" value={code} onChange={e => setCode(e.target.value.toUpperCase())}
          placeholder="e.g. K7XRMB"
          className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 font-mono tracking-widest placeholder-gray-400 focus:outline-none focus:border-[#1B3829]"
          maxLength={8} />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Your display name</label>
        <input type="text" value={myName} onChange={e => setMyName(e.target.value)}
          placeholder="e.g. Mike"
          className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#1B3829]" />
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
function LogProgressModal({ challenge, onSaved, onCancel }: {
  challenge: Challenge; onSaved: (c: Challenge) => void; onCancel: () => void;
}) {
  const me    = challenge.participants.find(p => p.is_me);
  const todayStr = today();
  const [value, setValue] = useState(String(me?.today_value || ""));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await api.logChallengeProgress(challenge.id, parseFloat(value));
      onSaved(updated);
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold text-gray-900">
            {challenge.type_info.icon} Log {challenge.type_info.label}
          </p>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>
        <p className="text-xs text-gray-400">
          {todayStr} · target: {challenge.target.toLocaleString()} {challenge.metric}
        </p>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Your {challenge.metric} today</label>
          <input type="number" step="any" value={value} onChange={e => setValue(e.target.value)}
            autoFocus
            className="w-full bg-white border border-gray-200 rounded-lg px-3 py-3 text-2xl font-bold text-gray-900 text-center focus:outline-none focus:border-[#1B3829]" />
          {value && !isNaN(parseFloat(value)) && (
            <p className="text-xs text-center text-gray-400 mt-1">
              {pct(parseFloat(value), challenge.target)}% of daily target
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-500 text-sm font-medium hover:text-gray-900 hover:border-gray-400 transition-colors">
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

// ── Main tab ──────────────────────────────────────────────────────────────────
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
    } finally { setLoading(false); }
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

  if (loading) return (
    <div className="flex items-center justify-center py-16">
      <div className="h-8 w-8 rounded-full border-2 border-[#1B3829] border-t-transparent animate-spin" />
    </div>
  );

  return (
    <div className="space-y-4">
      {logTarget && (
        <LogProgressModal challenge={logTarget} onSaved={handleLogged} onCancel={() => setLogTarget(null)} />
      )}

      {view === "create" && (
        <CreateChallengeForm onCreated={handleCreatedOrJoined} onCancel={() => setView("list")} />
      )}
      {view === "join" && (
        <JoinChallengeForm onJoined={handleCreatedOrJoined} onCancel={() => setView("list")} />
      )}

      {view === "list" && (
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setView("create")}
            className="flex items-center justify-center gap-2 py-3 rounded-xl bg-[#1B3829] text-white hover:bg-[#2D6A4F] text-sm font-medium transition-all">
            🚀 New challenge
          </button>
          <button onClick={() => setView("join")}
            className="flex items-center justify-center gap-2 py-3 rounded-xl border border-gray-200 bg-white text-gray-600 hover:text-gray-900 hover:border-gray-300 text-sm font-medium transition-all">
            🔗 Join with code
          </button>
        </div>
      )}

      {view === "list" && (
        challenges.length === 0 ? (
          <div className="text-center py-14 space-y-2">
            <p className="text-4xl">🏆</p>
            <p className="text-gray-500 text-sm font-medium">No challenges yet</p>
            <p className="text-gray-400 text-xs">Create one and share the code with a friend</p>
          </div>
        ) : (
          <div className="space-y-4">
            {challenges.map(c => (
              <ChallengeCard key={c.id} challenge={c} onRefresh={handleRefresh} onLog={setLogTarget} />
            ))}
          </div>
        )
      )}
    </div>
  );
}
