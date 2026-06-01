"use client";

import { useCallback, useEffect, useState } from "react";
import GEAR, { type GearItem } from "@/lib/gearData";
import {
  api,
  type GearReview,
  type GearReviewSummary,
  type GearFinderResult,
  type GearFinderPick,
  type GearDemand,
} from "@/lib/api";

// Flat lookup: catalog id -> { item, category icon }. Lets the Coach Al finder
// turn the ids it returns back into full product cards.
const ITEM_BY_ID = new Map<string, { item: GearItem; icon: string }>();
GEAR.forEach((cat) => cat.items.forEach((it) => ITEM_BY_ID.set(it.id, { item: it, icon: cat.icon })));

// A distinctive glyph per item (derived from its name/brand) so the no-photo
// placeholder reads as a varied, intentional catalog rather than one repeated
// category icon. Order matters: specific patterns before general ones.
const GLYPHS: [RegExp, string][] = [
  [/oura|\bring\b/, "💍"],
  [/apple watch|garmin|whoop|smartwatch|\bwatch\b/, "⌚"],
  [/inbody|smart scale|body scale|\bscale\b/, "⚖️"],
  [/blood pressure|withings bp/, "🩺"],
  [/glucose|cgm|stelo|dexcom|levels/, "🩸"],
  [/blood test|biomarker|finger.?prick|siphox|phlebotomy/, "🩸"],
  [/function health|superpower|insidetracker|inside ?tracker|quest|labcorp|everlywell|lab work|lab test|lab panel|test kit|diagnostic/, "🧪"],
  [/protein bar|\bbars?\b/, "🍫"],
  [/whey|protein|shake|isolate/, "🥤"],
  [/electrolyte|lmnt|hydration mix/, "🧂"],
  [/collagen/, "🧴"],
  [/magnesium|vitamin|omega|fish oil|creatine|\bd3\b|\bk2\b|zinc|nmn|ashwagandha|supplement|probiotic/, "💊"],
  [/sleep mask|eye mask|\bmask\b/, "😴"],
  [/pillow/, "🛏️"],
  [/blanket/, "🛌"],
  [/hatch|sunrise|wake.?up light|alarm|\blamp\b|\blight\b/, "🌅"],
  [/rower|rowing/, "🚣"],
  [/\bbike\b|cycle|peloton|spin/, "🚴"],
  [/treadmill|running/, "🏃"],
  [/dumbbell|kettlebell|barbell|adjustable|\bweights?\b/, "🏋️"],
  [/resistance|exercise band|loop band/, "🎗️"],
  [/\byoga\b|\bmat\b/, "🧘"],
  [/foam roll|\broller\b/, "🌀"],
  [/massage|theragun|percussion/, "💆"],
  [/sauna|infrared/, "🧖"],
  [/cold plunge|ice bath|\bplunge\b|chiller/, "🧊"],
  [/normatec|compression boot|recovery boot/, "🦵"],
  [/water bottle|\bbottle\b|hydration/, "💧"],
  [/headphone|earbud|airpod/, "🎧"],
  [/\bshoes?\b|sneaker/, "👟"],
  [/\bbook\b|reading/, "📖"],
];

function glyphFor(item: GearItem, categoryIcon: string): string {
  const s = `${item.name} ${item.brand}`.toLowerCase();
  for (const [re, g] of GLYPHS) if (re.test(s)) return g;
  return categoryIcon;
}

// Stable pastel hue per brand, so each card's placeholder has its own tint.
function brandHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

export default function GearTab() {
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [summary, setSummary] = useState<Record<string, GearReviewSummary>>({});
  const [reviewItem, setReviewItem] = useState<GearItem | null>(null);

  const loadSummary = useCallback(() => {
    api.gear.reviewsSummary().then(r => setSummary(r.summary || {})).catch(() => {});
  }, []);
  useEffect(() => { loadSummary(); }, [loadSummary]);

  const visibleCategories =
    activeCategory === "all" ? GEAR : GEAR.filter((c) => c.id === activeCategory);

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Gear</h2>
        <p className="mt-1 text-sm text-gray-600">
          Products we use and recommend — now with reviews from the BackNine community.
        </p>
      </div>

      {/* Category filter pills */}
      <div className="flex flex-wrap gap-2">
        <FilterPill label="All" icon="✦" active={activeCategory === "all"} onClick={() => setActiveCategory("all")} />
        {GEAR.map((cat) => (
          <FilterPill
            key={cat.id}
            label={cat.label}
            icon={cat.icon}
            active={activeCategory === cat.id}
            onClick={() => setActiveCategory(activeCategory === cat.id ? "all" : cat.id)}
          />
        ))}
      </div>

      {/* Stacked categories */}
      {visibleCategories.map((cat) => (
        <section key={cat.id} className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-xl">{cat.icon}</span>
            <h3 className="text-lg font-semibold text-gray-900">{cat.label}</h3>
            <div className="flex-1 h-px bg-gray-200 ml-2" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {cat.items.map((item) => (
              <ProductCard
                key={item.id}
                item={item}
                categoryIcon={cat.icon}
                summary={summary[item.id]}
                onOpenReviews={() => setReviewItem(item)}
              />
            ))}
          </div>
        </section>
      ))}

      {/* Coach Al gear finder — at the bottom of the shop */}
      <GearFinder summary={summary} onOpenReviews={setReviewItem} />

      {/* Owner-only: what people are searching for (renders only for admins) */}
      <GearDemandPanel />

      {reviewItem && (
        <GearReviewsModal
          item={reviewItem}
          onClose={() => setReviewItem(null)}
          onChanged={loadSummary}
        />
      )}
    </div>
  );
}

// ── Owner demand panel ───────────────────────────────────────────────────────
// Loads the demand list; the endpoint 403s for non-admins, so this silently
// renders nothing for everyone except the project owner.
function GearDemandPanel() {
  const [demand, setDemand] = useState<GearDemand | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api.gear.demand().then(setDemand).catch(() => setDemand(null));
  }, []);

  if (!demand) return null;

  const pct = demand.match_rate != null ? Math.round(demand.match_rate * 100) : null;

  return (
    <section className="rounded-2xl border border-amber-300/60 bg-amber-50/40 p-5 space-y-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">📈</span>
          <div>
            <p className="text-sm font-bold text-gray-900">What people are searching for</p>
            <p className="text-[11px] text-gray-600">
              Owner view · {demand.total_searches} search{demand.total_searches !== 1 ? "es" : ""}
              {pct != null ? ` · ${pct}% had a catalog match` : ""}
            </p>
          </div>
        </div>
        <span className="text-gray-600 text-sm">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="space-y-4 pt-1">
          {demand.total_searches === 0 ? (
            <p className="text-[13px] text-gray-600">
              No searches logged yet. As people use the gear finder, demand shows up here.
            </p>
          ) : (
            <>
              {demand.gaps.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide mb-2">
                    Most-requested gaps (not in catalog)
                  </p>
                  <div className="space-y-1">
                    {demand.gaps.map((g, i) => (
                      <div key={i} className="flex items-center justify-between rounded-lg bg-white border border-amber-100 px-3 py-1.5">
                        <span className="text-[13px] text-gray-800">{g.title}</span>
                        <span className="text-[11px] font-semibold text-amber-700 shrink-0 ml-2">
                          ×{g.count}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {demand.unmatched_queries.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide mb-2">
                    Searches with no match
                  </p>
                  <div className="space-y-1">
                    {demand.unmatched_queries.map((u, i) => (
                      <div key={i} className="flex items-center justify-between rounded-lg bg-white border border-gray-100 px-3 py-1.5">
                        <span className="text-[13px] text-gray-700 truncate">&ldquo;{u.query}&rdquo;</span>
                        {u.count > 1 && (
                          <span className="text-[11px] text-gray-600 shrink-0 ml-2">×{u.count}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {demand.recent.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide mb-2">
                    Recent searches
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {demand.recent.map((r, i) => (
                      <span key={i}
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] ${
                          r.had_match ? "bg-[#2D6A4F]/10 text-[#2D6A4F]" : "bg-gray-100 text-gray-600"
                        }`}>
                        {r.had_match ? "✓" : "—"} {r.query}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

// ── Coach Al gear finder ─────────────────────────────────────────────────────
const FINDER_EXAMPLES = [
  "Help me sleep better when I travel",
  "Recover faster after leg day",
  "Lower my blood pressure",
  "Build strength at home",
];

function GearFinder({
  summary, onOpenReviews,
}: {
  summary: Record<string, GearReviewSummary>;
  onOpenReviews: (item: GearItem) => void;
}) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GearFinderResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ask = async (q?: string) => {
    const text = (q ?? query).trim();
    if (!text || loading) return;
    setQuery(text);
    setLoading(true);
    setError(null);
    try {
      const r = await api.gear.ask(text);
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Coach Al couldn't answer just now — try again.");
    } finally {
      setLoading(false);
    }
  };

  // Turn the returned ids back into renderable catalog items (drop any unknown).
  const picks = (result?.picks || [])
    .map((p) => ({ pick: p, entry: ITEM_BY_ID.get(p.id) }))
    .filter(
      (x): x is { pick: GearFinderPick; entry: { item: GearItem; icon: string } } => !!x.entry
    );

  return (
    <div className="rounded-2xl border border-[#2D6A4F]/25 bg-gradient-to-br from-[#1B3829]/[0.04] to-white p-5 space-y-3">
      <div className="flex items-start gap-2">
        <span className="text-lg leading-none mt-0.5">🧭</span>
        <div>
          <p className="text-sm font-bold text-gray-900">Ask Coach Al for gear</p>
          <p className="text-[12px] text-gray-600 leading-snug">
            Tell me what you&apos;re trying to do — I&apos;ll find what fits, even if it&apos;s not in our store yet.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") ask(); }}
          placeholder="e.g. something to help me sleep when I travel"
          className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#2D6A4F]"
        />
        <button
          onClick={() => ask()}
          disabled={!query.trim() || loading}
          className="shrink-0 rounded-lg bg-[#1B3829] hover:bg-[#2D6A4F] px-4 py-2 text-xs font-semibold text-white transition-colors disabled:opacity-40"
        >
          {loading ? "…" : "Ask"}
        </button>
      </div>

      {!result && !loading && (
        <div className="flex flex-wrap gap-1.5">
          {FINDER_EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => ask(ex)}
              className="rounded-full border border-gray-200 bg-white px-3 py-1 text-[11px] text-gray-600 hover:border-[#2D6A4F] hover:text-[#2D6A4F] transition"
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <div className="h-4 w-4 rounded-full border-2 border-[#1B3829] border-t-transparent animate-spin" />
          Coach Al is looking through the gear…
        </div>
      )}

      {error && <p className="text-[12px] text-red-500">{error}</p>}

      {result && !loading && (
        <div className="space-y-4 pt-1">
          {result.intro && (
            <p className="text-sm text-gray-700 leading-relaxed">{result.intro}</p>
          )}

          {picks.length > 0 && (
            <div className="space-y-3">
              <p className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">
                From the BackNine store
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {picks.map(({ pick, entry }) => (
                  <div key={pick.id} className="space-y-1.5">
                    {pick.reason && (
                      <div className="flex gap-1.5 rounded-lg bg-[#2D6A4F]/[0.08] px-3 py-2 text-[12px] text-[#1B3829] leading-snug">
                        <span className="shrink-0">🧭</span>
                        <span>{pick.reason}</span>
                      </div>
                    )}
                    <ProductCard
                      item={entry.item}
                      categoryIcon={entry.icon}
                      summary={summary[entry.item.id]}
                      onOpenReviews={() => onOpenReviews(entry.item)}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.suggestions.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">
                Not in our store yet — what to look for
              </p>
              <div className="space-y-2">
                {result.suggestions.map((s, i) => (
                  <div key={i} className="rounded-xl border border-gray-200 bg-white p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900">{s.title}</p>
                        {s.detail && (
                          <p className="text-[12px] text-gray-600 mt-0.5 leading-snug">{s.detail}</p>
                        )}
                      </div>
                      {s.search && (
                        <a
                          href={`https://www.amazon.com/s?k=${encodeURIComponent(s.search)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 rounded-lg border border-[#2D6A4F]/40 px-2.5 py-1 text-[11px] font-semibold text-[#2D6A4F] hover:bg-[#2D6A4F]/10 transition"
                        >
                          Search →
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {picks.length === 0 && result.suggestions.length === 0 && (
            <p className="text-[13px] text-gray-600">
              Coach Al didn&apos;t find a match. Try describing what you want to achieve a different way.
            </p>
          )}

          <button
            onClick={() => { setResult(null); setQuery(""); setError(null); }}
            className="text-[12px] font-medium text-gray-600 hover:text-gray-700"
          >
            ↺ Ask something else
          </button>
        </div>
      )}
    </div>
  );
}

function FilterPill({ label, icon, active, onClick }: { label: string; icon: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition ${
        active ? "bg-[#2D6A4F] text-white" : "bg-white border border-gray-200 text-gray-600 hover:border-gray-300"
      }`}
    >
      <span>{icon}</span>
      {label}
    </button>
  );
}

function Stars({ value, size = "text-sm" }: { value: number; size?: string }) {
  const full = Math.round(value);
  return (
    <span className={`${size} text-amber-500 leading-none`}>
      {"★★★★★".slice(0, full)}<span className="text-gray-500">{"★★★★★".slice(full)}</span>
    </span>
  );
}

function ProductCard({
  item, categoryIcon, summary, onOpenReviews,
}: {
  item: GearItem;
  categoryIcon: string;
  summary?: GearReviewSummary;
  onOpenReviews: () => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const glyph = glyphFor(item, categoryIcon);
  const hue = brandHue(item.brand || item.name);

  return (
    <div className="flex flex-col rounded-2xl border border-gray-200 bg-white shadow-sm hover:shadow-md transition overflow-hidden">
      <a href={item.link} target="_blank" rel="noopener noreferrer" className="group block">
        {item.image && !imgFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.image}
            alt={item.name}
            className="w-full h-40 object-cover"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div
            className="w-full h-36 flex flex-col items-center justify-center gap-1.5"
            style={{ background: `linear-gradient(135deg, hsl(${hue} 45% 96%) 0%, hsl(${hue} 42% 88%) 100%)` }}
          >
            <span className="text-5xl leading-none">{glyph}</span>
            <span className="text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: `hsl(${hue} 35% 40%)` }}>
              {item.brand}
            </span>
          </div>
        )}
      </a>

      <div className="p-4 flex flex-col flex-1 space-y-2">
        {item.badge && (
          <span className="self-start text-xs font-semibold px-2 py-0.5 rounded-full bg-[#2D6A4F]/10 text-[#2D6A4F]">
            {item.badge}
          </span>
        )}
        <div>
          <p className="text-xs text-gray-600 font-medium">{item.brand}</p>
          <a href={item.link} target="_blank" rel="noopener noreferrer"
            className="font-semibold text-gray-900 hover:text-[#2D6A4F] transition leading-snug">
            {item.name}
          </a>
        </div>
        <p className="text-sm text-gray-600 flex-1 leading-relaxed">{item.description}</p>
        <div className="flex items-center justify-between pt-1">
          <span className="text-base font-bold text-gray-900">{item.price}</span>
          <a href={item.link} target="_blank" rel="noopener noreferrer"
            className="text-xs font-medium text-[#2D6A4F] hover:underline">
            View →
          </a>
        </div>

        {/* Reviews row */}
        <button
          onClick={onOpenReviews}
          className="mt-1 flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 hover:bg-gray-100 transition text-left"
        >
          {summary && summary.count > 0 ? (
            <span className="flex items-center gap-2 text-xs text-gray-600">
              {summary.avg != null && <Stars value={summary.avg} />}
              <span className="font-semibold">{summary.avg != null ? summary.avg : "—"}</span>
              <span className="text-gray-600">· {summary.count} review{summary.count !== 1 ? "s" : ""}</span>
            </span>
          ) : (
            <span className="text-xs text-gray-600">No reviews yet</span>
          )}
          <span className="text-[11px] font-semibold text-[#2D6A4F]">
            {summary && summary.count > 0 ? "Read / write →" : "Be the first →"}
          </span>
        </button>
      </div>
    </div>
  );
}

// ── Reviews modal ───────────────────────────────────────────────────────────────
function GearReviewsModal({ item, onClose, onChanged }: { item: GearItem; onClose: () => void; onChanged: () => void }) {
  const [reviews, setReviews] = useState<GearReview[] | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.gear.reviews(item.id)
      .then(r => {
        setReviews(r.reviews);
        const mine = r.reviews.find(x => x.is_me);
        if (mine) { setRating(mine.rating); setText(mine.text); }
      })
      .catch(() => setReviews([]));
  }, [item.id]);
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (saving) return;
    if (rating == null && !text.trim()) { setError("Add a star rating or a comment"); return; }
    setSaving(true); setError(null);
    try {
      await api.gear.postReview(item.id, rating, text.trim());
      load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your review");
    } finally { setSaving(false); }
  };

  const removeMine = async () => {
    try {
      await api.gear.deleteReview(item.id);
      setRating(null); setText("");
      load();
      onChanged();
    } catch { /* ignore */ }
  };

  const hasMine = reviews?.some(r => r.is_me);
  const others = (reviews || []).filter(r => !r.is_me);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white/95 backdrop-blur border-b border-gray-100 px-5 py-3 flex items-center justify-between">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-gray-900 truncate">{item.name}</h2>
            <p className="text-[11px] text-gray-600">{item.brand} · Community reviews</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-gray-100 text-gray-600 hover:text-gray-700 flex items-center justify-center text-lg leading-none">✕</button>
        </div>

        <div className="p-5 space-y-5">
          {/* Write / edit your review */}
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
            <p className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide mb-2">
              {hasMine ? "Your review" : "Write a review"}
            </p>
            <div className="flex items-center gap-1 mb-2">
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} onClick={() => setRating(r => (r === n ? null : n))}
                  className={`text-2xl leading-none transition-transform hover:scale-110 ${
                    rating != null && n <= rating ? "text-amber-500" : "text-gray-500"
                  }`} title={`${n} star${n > 1 ? "s" : ""}`}>★</button>
              ))}
              {rating != null && (
                <button onClick={() => setRating(null)} className="ml-1 text-[11px] text-gray-600 hover:text-gray-600">clear</button>
              )}
            </div>
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="What did you think? (optional)"
              rows={3}
              maxLength={1000}
              className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#2D6A4F]"
            />
            {error && <p className="text-[11px] text-red-500 mt-1">{error}</p>}
            <div className="flex items-center gap-2 mt-2">
              <button onClick={submit} disabled={saving}
                className="rounded-lg bg-[#1B3829] hover:bg-[#2D6A4F] px-4 py-2 text-xs font-semibold text-white transition-colors disabled:opacity-40">
                {saving ? "Saving…" : hasMine ? "Update review" : "Post review"}
              </button>
              {hasMine && (
                <button onClick={removeMine} className="text-[11px] text-gray-600 hover:text-red-500">Delete</button>
              )}
            </div>
          </div>

          {/* Everyone else's reviews */}
          {reviews === null ? (
            <div className="flex items-center justify-center py-6">
              <div className="h-5 w-5 rounded-full border-2 border-[#1B3829] border-t-transparent animate-spin" />
            </div>
          ) : others.length === 0 ? (
            <p className="text-[13px] text-gray-600 text-center py-2">
              {hasMine ? "No one else has reviewed this yet." : "Be the first to review this."}
            </p>
          ) : (
            <div className="space-y-3">
              {others.map(r => (
                <div key={r.id} className="border-b border-gray-50 pb-3 last:border-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-semibold text-gray-800">{r.user_name}</span>
                    {r.rating != null && <Stars value={r.rating} size="text-xs" />}
                  </div>
                  {r.text && <p className="text-[13px] text-gray-600 leading-snug">{r.text}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
