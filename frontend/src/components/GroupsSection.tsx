"use client";

/**
 * GroupsSection — Scorecard card listing the user's groups (Crews) with
 * actions to create a new one or join by code. Tapping a group opens the
 * shared group chat. Distinct from 1:1 DMs (those live on the leaderboard).
 */

import { useCallback, useEffect, useState } from "react";
import { api, type Group } from "@/lib/api";
import GroupChatDrawer from "@/components/GroupChatDrawer";

export default function GroupsSection() {
  const [groups, setGroups]   = useState<Group[] | null>(null);
  const [openGroup, setOpenGroup] = useState<Group | null>(null);
  const [mode, setMode]       = useState<"none" | "create" | "join">("none");
  const [name, setName]       = useState("");
  const [code, setCode]       = useState("");
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.groups.list();
      setGroups(res.groups);
    } catch {
      setGroups([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true); setError(null);
    try {
      const g = await api.groups.create(n);
      setName(""); setMode("none");
      await load();
      setOpenGroup(g);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create group");
    } finally { setBusy(false); }
  };

  const handleJoin = async () => {
    const c = code.trim();
    if (!c || busy) return;
    setBusy(true); setError(null);
    try {
      const g = await api.groups.join(c);
      setCode(""); setMode("none");
      await load();
      setOpenGroup(g);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't join — check the code");
    } finally { setBusy(false); }
  };

  if (groups === null) {
    return (
      <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="h-4 w-1/3 bg-gray-100 rounded animate-pulse" />
      </section>
    );
  }

  const inp = "flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#1B3829]";

  return (
    <section className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between border-b border-gray-50">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-400">Groups</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setMode(m => m === "join" ? "none" : "join"); setError(null); }}
            className="text-[11px] text-gray-400 hover:text-[#1B3829] font-medium transition-colors"
          >
            Join
          </button>
          <button
            onClick={() => { setMode(m => m === "create" ? "none" : "create"); setError(null); }}
            className="text-[11px] text-[#1B3829] font-semibold hover:underline"
          >
            ＋ New
          </button>
        </div>
      </div>

      {/* Create / Join inline forms */}
      {mode === "create" && (
        <div className="px-4 py-3 border-b border-gray-50 flex items-center gap-2">
          <input className={inp} placeholder="Group name (e.g. Run Club)" value={name}
            maxLength={60} onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleCreate(); }} />
          <button onClick={handleCreate} disabled={busy || !name.trim()}
            className="shrink-0 rounded-lg bg-[#1B3829] px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">
            {busy ? "…" : "Create"}
          </button>
        </div>
      )}
      {mode === "join" && (
        <div className="px-4 py-3 border-b border-gray-50 flex items-center gap-2">
          <input className={`${inp} uppercase`} placeholder="Enter invite code" value={code}
            maxLength={6} onChange={e => setCode(e.target.value.toUpperCase())}
            onKeyDown={e => { if (e.key === "Enter") handleJoin(); }} />
          <button onClick={handleJoin} disabled={busy || !code.trim()}
            className="shrink-0 rounded-lg bg-[#1B3829] px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">
            {busy ? "…" : "Join"}
          </button>
        </div>
      )}

      {error && (
        <p className="px-4 py-2 text-[11px] text-red-500 border-b border-gray-50">{error}</p>
      )}

      {/* Group list */}
      {groups.length === 0 ? (
        <div className="px-4 py-5 text-center">
          <p className="text-sm text-gray-500">No groups yet</p>
          <p className="text-xs text-gray-400 mt-0.5">
            Create one and share the code, or join with a friend&apos;s code — then chat together.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-gray-50">
          {groups.map(g => (
            <button
              key={g.id}
              onClick={() => setOpenGroup(g)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
            >
              <span className="w-8 h-8 rounded-full bg-[#1B3829]/10 text-base flex items-center justify-center shrink-0">👥</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">{g.name}</p>
                <p className="text-[11px] text-gray-400 truncate">
                  {g.member_count} member{g.member_count !== 1 ? "s" : ""} · {g.members.map(m => m.name).join(", ")}
                </p>
              </div>
              <span className="text-[11px] text-[#1B3829] font-semibold shrink-0">Chat →</span>
            </button>
          ))}
        </div>
      )}

      <GroupChatDrawer
        group={openGroup}
        onClose={() => setOpenGroup(null)}
        onLeft={() => load()}
      />
    </section>
  );
}
