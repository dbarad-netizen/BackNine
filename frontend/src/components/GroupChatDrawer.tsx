"use client";

/**
 * GroupChatDrawer — shared chat for a group (Crew). Everyone in the group sees
 * the thread; sender names are shown since it's multi-party. Mirrors
 * FriendDmDrawer (fixed bottom-right, polls every 8s while open). The header
 * exposes the join code to share and a Leave action.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Group, type GroupMessage, type GroupStandings, type GroupRecap, type Challenge } from "@/lib/api";

interface Props {
  group: Group | null;          // null = closed
  onClose: () => void;
  onLeft?: (groupId: string) => void;
}

export default function GroupChatDrawer({ group, onClose, onLeft }: Props) {
  const [messages, setMessages] = useState<GroupMessage[] | null>(null);
  const [text, setText]         = useState("");
  const [sending, setSending]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [copied, setCopied]     = useState(false);
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const [tab, setTab]           = useState<"chat" | "standings" | "recap" | "challenges">("chat");
  const [standings, setStandings] = useState<GroupStandings | null>(null);
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalInput, setGoalInput] = useState("");
  const [savingGoal, setSavingGoal] = useState(false);
  // Group recap state
  const [recap, setRecap]       = useState<GroupRecap | null>(null);
  // Group challenges state
  const [groupChallenges, setGroupChallenges] = useState<Challenge[] | null>(null);
  const [creatingChallenge, setCreatingChallenge] = useState(false);
  const [chForm, setChForm]     = useState({ name: "", type: "steps" as "steps" | "calories" | "protein" | "custom", target: "", duration: "7", custom_unit: "" });
  const [chBusy, setChBusy]     = useState(false);
  const [chError, setChError]   = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);
  const pollRef   = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (groupId: string) => {
    try {
      const res = await api.groups.messages(groupId);
      setMessages(res.messages);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load messages");
    }
  }, []);

  useEffect(() => {
    if (!group) {
      setMessages(null); setText(""); setError(null); setLeaveConfirm(false);
      setTab("chat"); setStandings(null); setEditingGoal(false);
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    load(group.id);
    pollRef.current = setInterval(() => { if (group) load(group.id); }, 8000);
    setTimeout(() => inputRef.current?.focus(), 200);
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [group, load]);

  useEffect(() => {
    if (group && tab === "chat") bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages?.length, group, tab]);

  // Load standings when switching to that tab.
  useEffect(() => {
    if (group && tab === "standings") {
      api.groups.standings(group.id).then(setStandings).catch(() => setStandings(null));
    }
  }, [group, tab]);

  // Load the group weekly recap when switching to that tab.
  useEffect(() => {
    if (group && tab === "recap") {
      api.groups.weeklyRecap(group.id).then(setRecap).catch(() => setRecap(null));
    }
  }, [group, tab]);

  // Load group challenges when switching to that tab.
  useEffect(() => {
    if (group && tab === "challenges") {
      api.groups.challenges(group.id).then(r => setGroupChallenges(r.challenges)).catch(() => setGroupChallenges([]));
    }
  }, [group, tab]);

  const submitNewChallenge = async () => {
    if (!group || chBusy) return;
    const name = chForm.name.trim();
    const target = parseFloat(chForm.target);
    const days = Math.max(1, parseInt(chForm.duration) || 7);
    if (!name) { setChError("Name is required"); return; }
    if (!Number.isFinite(target) || target <= 0) { setChError("Target must be a positive number"); return; }
    setChBusy(true); setChError(null);
    try {
      await api.groups.createChallenge(group.id, {
        name, type: chForm.type, target, duration_days: days,
        custom_unit: chForm.type === "custom" ? (chForm.custom_unit.trim() || "pts") : undefined,
      });
      const r = await api.groups.challenges(group.id);
      setGroupChallenges(r.challenges);
      setCreatingChallenge(false);
      setChForm({ name: "", type: "steps", target: "", duration: "7", custom_unit: "" });
    } catch (e) {
      setChError(e instanceof Error ? e.message : "Couldn't create challenge");
    } finally {
      setChBusy(false);
    }
  };

  const saveGoal = async (clear = false) => {
    if (!group || savingGoal) return;
    setSavingGoal(true);
    try {
      const goal = clear ? null : Math.max(0, parseInt(goalInput) || 0);
      await api.groups.setGoal(group.id, goal);
      const fresh = await api.groups.standings(group.id);
      setStandings(fresh);
      setEditingGoal(false);
      setGoalInput("");
    } catch { /* ignore */ }
    finally { setSavingGoal(false); }
  };

  const send = async () => {
    if (!group) return;
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    setError(null);
    const tempMsg: GroupMessage = {
      id: `tmp-${Date.now()}`, user_id: "me", user_name: "You",
      text: t, created_at: new Date().toISOString(), is_me: true,
    };
    setMessages(prev => [...(prev || []), tempMsg]);
    setText("");
    try {
      const saved = await api.groups.postMessage(group.id, t);
      setMessages(prev => (prev || []).map(m => m.id === tempMsg.id ? saved : m));
    } catch (e) {
      setMessages(prev => (prev || []).filter(m => m.id !== tempMsg.id));
      setText(t);
      setError(e instanceof Error ? e.message : "Couldn't send");
    } finally {
      setSending(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const copyCode = () => {
    if (!group) return;
    navigator.clipboard.writeText(group.join_code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  const handleLeave = async () => {
    if (!group) return;
    if (!leaveConfirm) {
      setLeaveConfirm(true);
      setTimeout(() => setLeaveConfirm(false), 3000);
      return;
    }
    try { await api.groups.leave(group.id); } catch { /* ignore */ }
    onLeft?.(group.id);
    onClose();
  };

  const fmtTime = (iso: string) => {
    try { return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); }
    catch { return ""; }
  };

  const open = !!group;

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-30 bg-black/20 sm:hidden" onClick={onClose} />
      )}
      <div
        className={`fixed bottom-5 left-4 right-4 sm:left-auto sm:w-[26rem] z-40 rounded-2xl bg-white shadow-2xl border border-gray-200 flex flex-col transition-all duration-300 ${
          open ? "opacity-100 translate-y-0 pointer-events-auto" : "opacity-0 translate-y-6 pointer-events-none"
        }`}
        style={{ maxHeight: "70vh", right: "1rem" }}
      >
        {open && group && (
          <>
            {/* Header */}
            <div
              className="px-4 py-3 shrink-0 rounded-t-2xl"
              style={{ background: "linear-gradient(135deg, #1B3829 0%, #2D6A4F 100%)" }}
            >
              <div className="flex items-center gap-3">
                <span className="w-9 h-9 rounded-full bg-white/20 text-white text-base flex items-center justify-center shrink-0">
                  👥
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-white leading-tight truncate">{group.name}</p>
                  <p className="text-[11px] text-white/60">
                    {group.member_count} member{group.member_count !== 1 ? "s" : ""}
                  </p>
                </div>
                <button onClick={onClose} className="text-white/60 hover:text-white text-xl leading-none">✕</button>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <button
                  onClick={copyCode}
                  className="text-[11px] text-white/90 bg-white/15 hover:bg-white/25 rounded-lg px-2 py-1 font-medium transition-colors"
                  title="Copy the join code to invite people"
                >
                  {copied ? "✓ Code copied" : `Invite code: ${group.join_code}`}
                </button>
                <span className="text-[10px] text-white/50 truncate flex-1">
                  {group.members.map(m => m.name).join(", ")}
                </span>
                <button
                  onClick={handleLeave}
                  className={`text-[10px] rounded-md px-2 py-1 transition-colors shrink-0 ${
                    leaveConfirm ? "bg-red-500 text-white" : "text-white/60 hover:text-white hover:bg-white/10"
                  }`}
                >
                  {leaveConfirm ? "Confirm leave?" : "Leave"}
                </button>
              </div>
            </div>

            {/* Tab toggle */}
            <div className="flex gap-1 px-3 pt-2 pb-1 border-b border-gray-50 shrink-0">
              {(["chat", "standings", "recap", "challenges"] as const).map(t => (
                <button key={t} onClick={() => setTab(t)}
                  className={`flex-1 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
                    tab === t ? "bg-[#1B3829] text-white" : "bg-gray-100 text-gray-600 hover:text-gray-800"
                  }`}>
                  {t === "chat" ? "💬 Chat"
                    : t === "standings" ? "🏆 Standings"
                    : t === "recap" ? "📣 Recap"
                    : "🎯 Challenges"}
                </button>
              ))}
            </div>

            {tab === "chat" && (<>
            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2 min-h-0">
              {messages === null && (
                <div className="flex items-center justify-center py-8">
                  <div className="h-5 w-5 rounded-full border-2 border-[#1B3829] border-t-transparent animate-spin" />
                </div>
              )}
              {messages?.length === 0 && (
                <p className="text-xs text-gray-600 italic text-center py-6">
                  No messages yet. Say hi to the group! Share the invite code above to add people.
                </p>
              )}
              {messages?.map(m => {
                // Coach Al's automated group posts use a sentinel user_id
                // and a hidden dedupe prefix in the text. Strip the prefix
                // on render and style the bubble with the brand tint so
                // it reads as a system note rather than a user message.
                const isCoach = m.user_id === "coach-al";
                let displayText = m.text;
                if (isCoach && displayText.startsWith("::bn-coach::")) {
                  // Format: ::bn-coach::<dedupe_key>::<visible text>
                  const stripped = displayText.replace(/^::bn-coach::[^:]*::/, "");
                  displayText = stripped || displayText;
                }
                if (isCoach) {
                  return (
                    <div key={m.id} className="flex flex-col items-start">
                      <p className="text-[10px] text-[#1B3829] mb-0.5 px-1 font-semibold uppercase tracking-wide">
                        💚 Coach Al
                      </p>
                      <div className="max-w-[88%] rounded-2xl px-3.5 py-2 text-sm leading-snug whitespace-pre-wrap break-words bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-bl-sm">
                        {displayText}
                      </div>
                      <p className="text-[9px] text-gray-600 mt-0.5 px-1">{fmtTime(m.created_at)}</p>
                    </div>
                  );
                }
                return (
                  <div key={m.id} className={`flex flex-col ${m.is_me ? "items-end" : "items-start"}`}>
                    {!m.is_me && (
                      <p className="text-[10px] text-gray-600 mb-0.5 px-1 font-medium">{m.user_name}</p>
                    )}
                    <div className={`max-w-[82%] rounded-2xl px-3.5 py-2 text-sm leading-snug whitespace-pre-wrap break-words ${
                      m.is_me ? "bg-[#1B3829] text-white rounded-br-sm" : "bg-gray-100 text-gray-800 rounded-bl-sm"
                    }`}>
                      {displayText}
                    </div>
                    <p className="text-[9px] text-gray-600 mt-0.5 px-1">{fmtTime(m.created_at)}</p>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            {error && (
              <div className="mx-3 mb-2 bg-red-50 border border-red-100 rounded-lg px-3 py-1.5 text-[11px] text-red-500">
                {error}
              </div>
            )}

            {/* Composer */}
            <div className="flex items-end gap-2 px-3 py-2.5 border-t border-gray-100 shrink-0">
              <textarea
                ref={inputRef}
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={handleKey}
                placeholder={`Message ${group.name}…`}
                rows={1}
                maxLength={2000}
                className="flex-1 resize-none rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#1B3829] focus:ring-1 focus:ring-[#1B3829]/20 leading-snug"
                style={{ maxHeight: "110px" }}
                onInput={e => {
                  const el = e.currentTarget;
                  el.style.height = "auto";
                  el.style.height = Math.min(el.scrollHeight, 110) + "px";
                }}
              />
              <button
                onClick={send}
                disabled={!text.trim() || sending}
                className="w-9 h-9 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:scale-105 flex items-center justify-center text-white shrink-0"
                style={{ background: "linear-gradient(135deg, #1B3829 0%, #2D6A4F 100%)" }}
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" style={{ transform: "rotate(90deg)" }}>
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                </svg>
              </button>
            </div>
            </>)}

            {tab === "standings" && (
              <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0">
                {standings === null ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="h-5 w-5 rounded-full border-2 border-[#1B3829] border-t-transparent animate-spin" />
                  </div>
                ) : (
                  <>
                    {/* Shared weekly goal */}
                    {(standings.goal == null && !editingGoal) ? (
                      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 mb-3">
                        <p className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide mb-1.5">Weekly group goal</p>
                        <button onClick={() => { setEditingGoal(true); setGoalInput(""); }}
                          className="text-xs font-semibold text-[#1B3829] hover:underline">
                          ＋ Set a shared points goal
                        </button>
                      </div>
                    ) : editingGoal ? (
                      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 mb-3">
                        <p className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide mb-1.5">Weekly group goal</p>
                        <div className="flex items-center gap-2">
                          <input type="number" min={0} placeholder="e.g. 500" value={goalInput}
                            onChange={e => setGoalInput(e.target.value)}
                            className="w-24 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-[#1B3829]" />
                          <span className="text-xs text-gray-600">pts / week</span>
                          <button onClick={() => saveGoal(false)} disabled={savingGoal || !goalInput}
                            className="ml-auto rounded-lg bg-[#1B3829] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
                            {savingGoal ? "…" : "Save"}
                          </button>
                          {standings.goal != null && (
                            <button onClick={() => saveGoal(true)} className="text-[11px] text-gray-600 hover:text-red-500">Clear</button>
                          )}
                        </div>
                      </div>
                    ) : (() => {
                      const goal = standings.goal as number;
                      const total = standings.total;
                      const pct = Math.min(100, Math.round((total / Math.max(1, goal)) * 100));
                      const done = total >= goal;
                      return (
                        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 mb-3">
                          <div className="flex items-center justify-between mb-1.5">
                            <p className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Weekly group goal</p>
                            <button onClick={() => { setEditingGoal(true); setGoalInput(String(goal)); }}
                              className="text-[10px] text-gray-600 hover:text-gray-700 underline">edit</button>
                          </div>
                          <div className="flex items-baseline justify-between mb-1">
                            <span className="text-lg font-bold text-gray-900">
                              {total.toLocaleString()}
                              <span className="text-xs text-gray-600 font-normal"> / {goal.toLocaleString()} pts</span>
                            </span>
                            <span className={`text-xs font-semibold ${done ? "text-green-600" : "text-gray-600"}`}>
                              {done ? "🎉 Goal hit!" : `${pct}%`}
                            </span>
                          </div>
                          <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
                            <div className="h-full rounded-full transition-all duration-500"
                              style={{ width: `${pct}%`, backgroundColor: done ? "#22c55e" : "#1B3829" }} />
                          </div>
                        </div>
                      );
                    })()}

                    {/* Member ranking */}
                    <p className="text-[11px] font-semibold text-gray-600 uppercase tracking-widest mb-1.5">This week</p>
                    <div className="divide-y divide-gray-50">
                      {standings.members.map(m => (
                        <div key={m.user_id} className="flex items-center gap-3 py-2">
                          <span className="w-6 text-center text-sm text-gray-600">
                            {m.rank <= 3 ? ["🥇", "🥈", "🥉"][m.rank - 1] : m.rank}
                          </span>
                          <span className={`flex-1 text-sm truncate ${m.is_me ? "font-bold text-[#1B3829]" : "text-gray-700"}`}>
                            {m.is_me ? "You" : m.name}
                          </span>
                          <span className="text-sm font-semibold text-gray-900">{m.points.toLocaleString()}</span>
                          <span className="text-[11px] text-gray-600">pts</span>
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-gray-600 mt-3">
                      Points: daily check-in, logged workouts/meals/weigh-ins + a step bonus.
                    </p>
                  </>
                )}
              </div>
            )}

            {/* ── Group weekly recap ── */}
            {tab === "recap" && (
              <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0">
                {recap === null ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="h-5 w-5 rounded-full border-2 border-[#1B3829] border-t-transparent animate-spin" />
                  </div>
                ) : (
                  <>
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 mb-3">
                      <p className="text-[10px] uppercase tracking-wide font-semibold text-amber-800 mb-0.5">Coach Al · crew recap</p>
                      <p className="text-sm text-gray-900 leading-snug">{recap.headline}</p>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      <div className="rounded-lg border border-emerald-200 bg-white px-2 py-2 text-center">
                        <p className="text-[10px] uppercase tracking-wide font-semibold text-emerald-800">Sessions</p>
                        <p className="text-lg font-bold text-gray-900">{recap.totals.workouts}</p>
                      </div>
                      <div className="rounded-lg border border-amber-200 bg-white px-2 py-2 text-center">
                        <p className="text-[10px] uppercase tracking-wide font-semibold text-amber-800">PRs</p>
                        <p className="text-lg font-bold text-gray-900">{recap.totals.pr_count}</p>
                      </div>
                      <div className="rounded-lg border border-sky-200 bg-white px-2 py-2 text-center">
                        <p className="text-[10px] uppercase tracking-wide font-semibold text-sky-800">Active</p>
                        <p className="text-lg font-bold text-gray-900">{recap.totals.active_members}</p>
                      </div>
                    </div>
                    {recap.top_performers.pr && (
                      <div className="rounded-lg border border-amber-200 bg-white px-3 py-2 mb-2">
                        <p className="text-[10px] uppercase tracking-wide font-semibold text-amber-800">🏆 Top lift this week</p>
                        <p className="text-sm text-gray-900">
                          {recap.top_performers.pr.name} on <span className="capitalize">{recap.top_performers.pr.exercise}</span> — {recap.top_performers.pr.e1rm_lbs} lb e1RM
                        </p>
                      </div>
                    )}
                    {recap.leaderboard.length > 0 && (
                      <>
                        <p className="text-[11px] font-semibold text-gray-600 uppercase tracking-widest mb-1.5 mt-3">Member highlights</p>
                        <div className="divide-y divide-gray-50">
                          {recap.leaderboard.map(m => (
                            <div key={m.user_id} className="flex items-center gap-2 py-2">
                              <span className="flex-1 text-sm text-gray-800 truncate">{m.name}</span>
                              <span className="text-[11px] text-gray-700">
                                {m.workouts > 0 && <>{m.workouts}🏋️ </>}
                                {m.pr_count > 0 && <>{m.pr_count}🏆 </>}
                                {m.sleep_streak >= 3 && <>{m.sleep_streak}💤 </>}
                                {m.protein_days >= 3 && <>{m.protein_days}🥩</>}
                              </span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ── Group challenges ── */}
            {tab === "challenges" && (
              <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0">
                {groupChallenges === null ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="h-5 w-5 rounded-full border-2 border-[#1B3829] border-t-transparent animate-spin" />
                  </div>
                ) : (
                  <>
                    {!creatingChallenge ? (
                      <button onClick={() => setCreatingChallenge(true)}
                        className="w-full rounded-xl bg-[#1B3829] hover:bg-[#2D6A4F] text-white text-sm font-semibold py-2 mb-3 transition-colors">
                        ＋ Start a group challenge
                      </button>
                    ) : (
                      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 mb-3 space-y-2">
                        <p className="text-[11px] uppercase tracking-wide font-semibold text-gray-700">New group challenge</p>
                        <input
                          value={chForm.name}
                          onChange={e => setChForm({ ...chForm, name: e.target.value })}
                          placeholder="e.g. 30 days of 10k steps"
                          maxLength={60}
                          className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-900"
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <select value={chForm.type}
                            onChange={e => setChForm({ ...chForm, type: e.target.value as typeof chForm.type })}
                            className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-900">
                            <option value="steps">Steps / day</option>
                            <option value="calories">Calories / day</option>
                            <option value="protein">Protein g / day</option>
                            <option value="custom">Custom</option>
                          </select>
                          <input type="number" inputMode="numeric"
                            value={chForm.target}
                            onChange={e => setChForm({ ...chForm, target: e.target.value })}
                            placeholder="Target / day"
                            className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-900"
                          />
                        </div>
                        {chForm.type === "custom" && (
                          <input
                            value={chForm.custom_unit}
                            onChange={e => setChForm({ ...chForm, custom_unit: e.target.value })}
                            placeholder="Custom unit (e.g. pages, miles)"
                            maxLength={20}
                            className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-900"
                          />
                        )}
                        <div className="flex items-center gap-2">
                          <input type="number" inputMode="numeric"
                            value={chForm.duration}
                            onChange={e => setChForm({ ...chForm, duration: e.target.value })}
                            placeholder="Days"
                            className="w-20 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-900"
                          />
                          <span className="text-xs text-gray-600">days long</span>
                          <button onClick={submitNewChallenge} disabled={chBusy}
                            className="ml-auto rounded-lg bg-[#1B3829] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
                            {chBusy ? "…" : "Create"}
                          </button>
                          <button onClick={() => { setCreatingChallenge(false); setChError(null); }}
                            className="text-xs text-gray-600 hover:text-gray-900">Cancel</button>
                        </div>
                        {chError && <p className="text-[11px] text-red-600">{chError}</p>}
                      </div>
                    )}
                    {groupChallenges.length === 0 ? (
                      <p className="text-xs text-gray-600 italic text-center py-4">
                        No group challenges yet. Spin one up — the whole crew sees and joins.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {groupChallenges.map(c => (
                          <div key={c.id} className="rounded-xl border border-gray-200 bg-white p-3">
                            <div className="flex items-baseline justify-between gap-2">
                              <p className="text-sm font-semibold text-gray-900 truncate">{c.name}</p>
                              <span className="text-[10px] text-gray-600 shrink-0">
                                {c.is_active ? `${c.days_left}d left` : "Ended"}
                              </span>
                            </div>
                            <p className="text-[11px] text-gray-600 mt-0.5">
                              Target: {c.target} {c.metric} / day · {c.duration_days}-day
                            </p>
                            {c.participants && c.participants.length > 0 && (
                              <p className="text-[11px] text-gray-700 mt-1">
                                {c.participants.length} player{c.participants.length === 1 ? "" : "s"} · top: {c.participants[0].display_name} ({c.participants[0].days_hit} hits)
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
