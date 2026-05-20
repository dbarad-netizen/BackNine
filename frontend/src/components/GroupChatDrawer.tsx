"use client";

/**
 * GroupChatDrawer — shared chat for a group (Crew). Everyone in the group sees
 * the thread; sender names are shown since it's multi-party. Mirrors
 * FriendDmDrawer (fixed bottom-right, polls every 8s while open). The header
 * exposes the join code to share and a Leave action.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Group, type GroupMessage, type GroupStandings } from "@/lib/api";

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
  const [tab, setTab]           = useState<"chat" | "standings">("chat");
  const [standings, setStandings] = useState<GroupStandings | null>(null);
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalInput, setGoalInput] = useState("");
  const [savingGoal, setSavingGoal] = useState(false);
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
              {(["chat", "standings"] as const).map(t => (
                <button key={t} onClick={() => setTab(t)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    tab === t ? "bg-[#1B3829] text-white" : "bg-gray-100 text-gray-500 hover:text-gray-800"
                  }`}>
                  {t === "chat" ? "💬 Chat" : "🏆 Standings"}
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
                <p className="text-xs text-gray-400 italic text-center py-6">
                  No messages yet. Say hi to the group! Share the invite code above to add people.
                </p>
              )}
              {messages?.map(m => (
                <div key={m.id} className={`flex flex-col ${m.is_me ? "items-end" : "items-start"}`}>
                  {!m.is_me && (
                    <p className="text-[10px] text-gray-400 mb-0.5 px-1 font-medium">{m.user_name}</p>
                  )}
                  <div className={`max-w-[82%] rounded-2xl px-3.5 py-2 text-sm leading-snug whitespace-pre-wrap break-words ${
                    m.is_me ? "bg-[#1B3829] text-white rounded-br-sm" : "bg-gray-100 text-gray-800 rounded-bl-sm"
                  }`}>
                    {m.text}
                  </div>
                  <p className="text-[9px] text-gray-400 mt-0.5 px-1">{fmtTime(m.created_at)}</p>
                </div>
              ))}
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
                        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Weekly group goal</p>
                        <button onClick={() => { setEditingGoal(true); setGoalInput(""); }}
                          className="text-xs font-semibold text-[#1B3829] hover:underline">
                          ＋ Set a shared points goal
                        </button>
                      </div>
                    ) : editingGoal ? (
                      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 mb-3">
                        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Weekly group goal</p>
                        <div className="flex items-center gap-2">
                          <input type="number" min={0} placeholder="e.g. 500" value={goalInput}
                            onChange={e => setGoalInput(e.target.value)}
                            className="w-24 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-[#1B3829]" />
                          <span className="text-xs text-gray-400">pts / week</span>
                          <button onClick={() => saveGoal(false)} disabled={savingGoal || !goalInput}
                            className="ml-auto rounded-lg bg-[#1B3829] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
                            {savingGoal ? "…" : "Save"}
                          </button>
                          {standings.goal != null && (
                            <button onClick={() => saveGoal(true)} className="text-[11px] text-gray-400 hover:text-red-500">Clear</button>
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
                            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Weekly group goal</p>
                            <button onClick={() => { setEditingGoal(true); setGoalInput(String(goal)); }}
                              className="text-[10px] text-gray-400 hover:text-gray-700 underline">edit</button>
                          </div>
                          <div className="flex items-baseline justify-between mb-1">
                            <span className="text-lg font-bold text-gray-900">
                              {total.toLocaleString()}
                              <span className="text-xs text-gray-400 font-normal"> / {goal.toLocaleString()} pts</span>
                            </span>
                            <span className={`text-xs font-semibold ${done ? "text-green-600" : "text-gray-500"}`}>
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
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-1.5">This week</p>
                    <div className="divide-y divide-gray-50">
                      {standings.members.map(m => (
                        <div key={m.user_id} className="flex items-center gap-3 py-2">
                          <span className="w-6 text-center text-sm text-gray-400">
                            {m.rank <= 3 ? ["🥇", "🥈", "🥉"][m.rank - 1] : m.rank}
                          </span>
                          <span className={`flex-1 text-sm truncate ${m.is_me ? "font-bold text-[#1B3829]" : "text-gray-700"}`}>
                            {m.is_me ? "You" : m.name}
                          </span>
                          <span className="text-sm font-semibold text-gray-900">{m.points.toLocaleString()}</span>
                          <span className="text-[11px] text-gray-400">pts</span>
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-gray-400 mt-3">
                      Points: daily check-in, logged workouts/meals/weigh-ins + a step bonus.
                    </p>
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
