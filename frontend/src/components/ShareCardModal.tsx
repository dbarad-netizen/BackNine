"use client";

/**
 * ShareCardModal — shareable "brag + invite" cards for community growth.
 *
 * Renders one of four cards (Longevity Score, day streak, head-to-head win, or a
 * generic invite) to a real PNG via the canvas API — no external libraries — and
 * shares it through the Web Share API (with copy-link / download fallbacks on
 * desktop). Every card carries the user's reusable referral link
 * (https://<app>/?ref=CODE); when a recipient signs up they're auto-connected as
 * a friend (see friends.accept_referral).
 */

import { useEffect, useMemo, useState } from "react";
import { api, type ReferralCode } from "@/lib/api";

type CardKey = "longevity" | "streak" | "h2h" | "generic";

interface LongevityLite {
  score: number | null;
  grade: string | null;
  biological_age_delta: number | null;
}

interface Props {
  onClose: () => void;
  longevity?: LongevityLite | null;
}

interface CardContent {
  eyebrow:   string;
  big:       string;
  sub:       string;
  shareText: string;
}

const TAB_LABEL: Record<CardKey, string> = {
  longevity: "Longevity",
  streak:    "Streak",
  h2h:       "Matchup",
  generic:   "Invite",
};

const METRIC_LABEL: Record<string, string> = {
  steps: "steps", sleep: "sleep", activity: "activity",
};

interface H2HWin { friendName: string; w: number; l: number; metric: string; }

// ── Canvas rendering ────────────────────────────────────────────────────────────

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitFont(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, startPx: number, weight = "800"): number {
  let px = startPx;
  for (let i = 0; i < 40; i++) {
    ctx.font = `${weight} ${px}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    if (ctx.measureText(text).width <= maxWidth || px <= 48) break;
    px -= 8;
  }
  return px;
}

function renderCanvas(card: CardContent, code: string): HTMLCanvasElement {
  const S = 1080;
  const canvas = document.createElement("canvas");
  canvas.width = S; canvas.height = S;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  // Background gradient
  const grad = ctx.createLinearGradient(0, 0, S, S);
  grad.addColorStop(0,   "#0f1a15");
  grad.addColorStop(0.55, "#1B3829");
  grad.addColorStop(1,   "#2D6A4F");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);

  // Soft highlight
  const rg = ctx.createRadialGradient(S * 0.5, S * 0.32, 60, S * 0.5, S * 0.32, S * 0.7);
  rg.addColorStop(0, "rgba(74,222,128,0.16)");
  rg.addColorStop(1, "rgba(74,222,128,0)");
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, S, S);

  ctx.textAlign = "center";

  // Wordmark
  ctx.font = "800 60px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  const back = "Back", nine = "Nine";
  const wBack = ctx.measureText(back).width;
  const wNine = ctx.measureText(nine).width;
  const totalW = wBack + wNine;
  const startX = S / 2 - totalW / 2;
  ctx.textAlign = "left";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(back, startX, 150);
  ctx.fillStyle = "#4ade80";
  ctx.fillText(nine, startX + wBack, 150);
  ctx.textAlign = "center";

  // Eyebrow
  try { (ctx as unknown as { letterSpacing: string }).letterSpacing = "6px"; } catch { /* ignore */ }
  ctx.font = "700 30px ui-sans-serif, system-ui, sans-serif";
  ctx.fillStyle = "rgba(167,243,208,0.85)";
  ctx.fillText(card.eyebrow.toUpperCase(), S / 2, 430);
  try { (ctx as unknown as { letterSpacing: string }).letterSpacing = "0px"; } catch { /* ignore */ }

  // Big stat (auto-fit width)
  const bigPx = fitFont(ctx, card.big, S - 160, card.big.length <= 4 ? 300 : 200, "800");
  ctx.font = `800 ${bigPx}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(card.big, S / 2, 640);

  // Subtitle (wrap to two lines if needed)
  ctx.font = "600 40px ui-sans-serif, system-ui, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.82)";
  const words = card.sub.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > S - 180 && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  lines.slice(0, 2).forEach((ln, i) => ctx.fillText(ln, S / 2, 730 + i * 54));

  // Footer pill: "JOIN ME ON BACKNINE" + code
  const pillW = 720, pillH = 132, pillX = S / 2 - pillW / 2, pillY = 880;
  ctx.fillStyle = "rgba(255,255,255,0.10)";
  roundRectPath(ctx, pillX, pillY, pillW, pillH, 28);
  ctx.fill();
  ctx.strokeStyle = "rgba(74,222,128,0.4)";
  ctx.lineWidth = 2;
  roundRectPath(ctx, pillX, pillY, pillW, pillH, 28);
  ctx.stroke();

  ctx.font = "700 26px ui-sans-serif, system-ui, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.fillText("JOIN ME ON BACKNINE", S / 2, pillY + 50);
  if (code) {
    ctx.font = "800 46px ui-sans-serif, system-ui, sans-serif";
    ctx.fillStyle = "#4ade80";
    ctx.fillText(`Invite code: ${code}`, S / 2, pillY + 102);
  } else {
    ctx.font = "600 30px ui-sans-serif, system-ui, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText("Tap the link to join", S / 2, pillY + 100);
  }

  return canvas;
}

function buildCard(
  tab: CardKey,
  longevity: LongevityLite | null | undefined,
  appStreak: number | null,
  h2h: H2HWin | null,
): CardContent {
  if (tab === "longevity" && longevity?.score != null) {
    const d = longevity.biological_age_delta;
    const sub =
      d != null && d !== 0
        ? `${longevity.grade ?? ""} · ${Math.abs(d)} yrs ${d < 0 ? "younger" : "older"} than my age`
        : (longevity.grade ?? "My vitality score");
    return {
      eyebrow:   "Longevity Score",
      big:       String(longevity.score),
      sub,
      shareText: `My BackNine Longevity Score is ${longevity.score}${longevity.grade ? ` (${longevity.grade})` : ""}. Track yours and let's compare 👇`,
    };
  }
  if (tab === "streak" && appStreak != null) {
    return {
      eyebrow:   "Current Streak",
      big:       String(appStreak),
      sub:       "days in a row on BackNine 🔥",
      shareText: `I'm on a ${appStreak}-day streak on BackNine 🔥 Join me and let's keep each other accountable 👇`,
    };
  }
  if (tab === "h2h" && h2h) {
    const m = METRIC_LABEL[h2h.metric] ?? h2h.metric;
    return {
      eyebrow:   "This Week's Matchup",
      big:       `${h2h.w}–${h2h.l}`,
      sub:       `Beating ${h2h.friendName} on ${m} this week`,
      shareText: `Winning my BackNine ${m} matchup ${h2h.w}–${h2h.l} this week 😎 Come get a rematch 👇`,
    };
  }
  return {
    eyebrow:   "Personal Health Intelligence",
    big:       "BackNine",
    sub:       "Track recovery, sleep & longevity",
    shareText: "I'm tracking my health on BackNine — recovery, sleep & longevity in one place. Join me 👇",
  };
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(b => resolve(b), "image/png"));
}

// ── Component ───────────────────────────────────────────────────────────────────

export default function ShareCardModal({ onClose, longevity }: Props) {
  const [referral, setReferral]   = useState<ReferralCode | null>(null);
  const [appStreak, setAppStreak] = useState<number | null>(null);
  const [h2h, setH2h]             = useState<H2HWin | null>(null);
  const [loading, setLoading]     = useState(true);
  const [tab, setTab]             = useState<CardKey>("generic");
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [status, setStatus]       = useState<"" | "shared" | "copied" | "downloaded">("");
  const [busy, setBusy]           = useState(false);

  // Fetch everything the cards need, best-effort.
  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      api.friends.referral(),
      api.briefing(),
      api.friends.leaderboard(),
    ]).then(([refRes, brRes, lbRes]) => {
      if (cancelled) return;
      if (refRes.status === "fulfilled") setReferral(refRes.value);
      if (brRes.status === "fulfilled") setAppStreak(brRes.value.app_streak ?? null);
      if (lbRes.status === "fulfilled") {
        let best: (H2HWin & { margin: number }) | null = null;
        for (const e of lbRes.value.entries) {
          if (e.is_me || !e.head_to_head) continue;
          (["steps", "sleep", "activity"] as const).forEach(m => {
            const t = e.head_to_head![m];
            if (t && t.w > t.l) {
              const margin = t.w - t.l;
              if (!best || margin > best.margin) {
                best = { friendName: e.name, w: t.w, l: t.l, metric: m, margin };
              }
            }
          });
        }
        if (best) setH2h({ friendName: best.friendName, w: best.w, l: best.l, metric: best.metric });
      }
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const available = useMemo<CardKey[]>(() => {
    const order: CardKey[] = [];
    if (longevity?.score != null) order.push("longevity");
    if (appStreak != null && appStreak >= 2) order.push("streak");
    if (h2h) order.push("h2h");
    order.push("generic");
    return order;
  }, [longevity, appStreak, h2h]);

  // Default to the most brag-worthy available card once data settles.
  useEffect(() => {
    if (!loading) setTab(available[0]);
  }, [loading, available]);

  const card = useMemo(() => buildCard(tab, longevity, appStreak, h2h), [tab, longevity, appStreak, h2h]);

  const inviteLink = useMemo(() => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return referral ? `${origin}/?ref=${referral.code}` : origin;
  }, [referral]);

  // Re-render the preview image whenever the card or code changes.
  useEffect(() => {
    if (loading) return;
    try {
      const canvas = renderCanvas(card, referral?.code ?? "");
      setPreviewUrl(canvas.toDataURL("image/png"));
    } catch { /* ignore */ }
  }, [card, referral, loading]);

  const copyToClipboard = async (text: string) => {
    try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
  };

  const handleShare = async () => {
    if (busy) return;
    setBusy(true);
    setStatus("");
    try {
      const canvas = renderCanvas(card, referral?.code ?? "");
      const blob = await canvasToBlob(canvas);
      const text = `${card.shareText} ${inviteLink}`.trim();

      // Cast to optional Web Share methods — they're typed as always-present
      // but don't exist in every browser (notably desktop).
      const nav = (typeof navigator !== "undefined" ? navigator : undefined) as unknown as
        | { canShare?: (d?: { files?: File[] }) => boolean; share?: (d?: unknown) => Promise<void> }
        | undefined;
      if (blob && nav?.canShare && nav.share) {
        const file = new File([blob], "backnine.png", { type: "image/png" });
        if (nav.canShare({ files: [file] })) {
          await nav.share({ files: [file], text, title: "BackNine" });
          setStatus("shared");
          return;
        }
      }
      if (nav?.share) {
        await nav.share({ text, title: "BackNine", url: inviteLink });
        setStatus("shared");
        return;
      }
      // Desktop fallback: download the image + copy the link.
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = "backnine-card.png"; a.click();
        URL.revokeObjectURL(url);
      }
      await copyToClipboard(inviteLink);
      setStatus("downloaded");
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return; // user cancelled share sheet
      if (await copyToClipboard(inviteLink)) setStatus("copied");
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    if (await copyToClipboard(inviteLink)) {
      setStatus("copied");
      setTimeout(() => setStatus(s => (s === "copied" ? "" : s)), 2500);
    }
  };

  const handleDownload = async () => {
    const canvas = renderCanvas(card, referral?.code ?? "");
    const blob = await canvasToBlob(canvas);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "backnine-card.png"; a.click();
    URL.revokeObjectURL(url);
    setStatus("downloaded");
    setTimeout(() => setStatus(s => (s === "downloaded" ? "" : s)), 2500);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[92vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white/95 backdrop-blur border-b border-gray-100 px-5 py-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-gray-900">Invite friends</h2>
            <p className="text-[11px] text-gray-400">Share a card — they join you instantly</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-700 flex items-center justify-center text-lg leading-none">✕</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Card-type tabs */}
          <div className="flex gap-1.5 flex-wrap">
            {available.map(k => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`text-[12px] font-semibold px-3 py-1.5 rounded-full transition-colors ${
                  tab === k ? "bg-[#1B3829] text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                }`}
              >
                {TAB_LABEL[k]}
              </button>
            ))}
          </div>

          {/* Preview */}
          <div className="rounded-2xl overflow-hidden bg-gray-100 aspect-square flex items-center justify-center">
            {loading ? (
              <div className="h-8 w-8 rounded-full border-2 border-[#1B3829] border-t-transparent animate-spin" />
            ) : previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt="Share card preview" className="w-full h-full object-contain" />
            ) : null}
          </div>

          {/* Invite link row */}
          <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
            <span className="text-[11px] text-gray-500 truncate flex-1">{inviteLink || "Preparing your link…"}</span>
            <button
              onClick={handleCopy}
              className="text-[11px] font-semibold text-[#1B3829] hover:underline shrink-0"
            >
              Copy
            </button>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={handleShare}
              disabled={busy || loading}
              className="flex-1 py-3 rounded-xl bg-[#1B3829] hover:bg-[#2D6A4F] text-white text-sm font-semibold transition-colors disabled:opacity-50"
            >
              {busy ? "Opening…" : "Share card"}
            </button>
            <button
              onClick={handleDownload}
              disabled={loading}
              className="px-4 py-3 rounded-xl border border-gray-200 text-gray-600 text-sm font-semibold hover:bg-gray-50 transition-colors disabled:opacity-50"
              title="Save the image"
            >
              Save
            </button>
          </div>

          {/* Status */}
          <p className="text-[11px] text-center min-h-[1em] text-gray-400">
            {status === "shared" && "✓ Shared"}
            {status === "copied" && "✓ Link copied to clipboard"}
            {status === "downloaded" && "✓ Image saved — link copied too"}
          </p>
        </div>
      </div>
    </div>
  );
}
