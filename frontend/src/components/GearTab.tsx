"use client";

import { useCallback, useEffect, useState } from "react";
import GEAR, { type GearItem } from "@/lib/gearData";
import { api, type GearReview, type GearReviewSummary } from "@/lib/api";

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
        <p className="mt-1 text-sm text-gray-500">
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
      {"★★★★★".slice(0, full)}<span className="text-gray-300">{"★★★★★".slice(full)}</span>
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
  return (
    <div className="flex flex-col rounded-2xl border border-gray-200 bg-white shadow-sm hover:shadow-md transition overflow-hidden">
      <a href={item.link} target="_blank" rel="noopener noreferrer" className="group block">
        {item.image ? (
          <img src={item.image} alt={item.name} className="w-full h-40 object-cover" />
        ) : (
          <div className="w-full h-32 bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center text-4xl">
            {categoryIcon}
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
          <p className="text-xs text-gray-400 font-medium">{item.brand}</p>
          <a href={item.link} target="_blank" rel="noopener noreferrer"
            className="font-semibold text-gray-900 hover:text-[#2D6A4F] transition leading-snug">
            {item.name}
          </a>
        </div>
        <p className="text-sm text-gray-500 flex-1 leading-relaxed">{item.description}</p>
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
              <span className="text-gray-400">· {summary.count} review{summary.count !== 1 ? "s" : ""}</span>
            </span>
          ) : (
            <span className="text-xs text-gray-400">No reviews yet</span>
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
            <p className="text-[11px] text-gray-400">{item.brand} · Community reviews</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-700 flex items-center justify-center text-lg leading-none">✕</button>
        </div>

        <div className="p-5 space-y-5">
          {/* Write / edit your review */}
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">
              {hasMine ? "Your review" : "Write a review"}
            </p>
            <div className="flex items-center gap-1 mb-2">
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} onClick={() => setRating(r => (r === n ? null : n))}
                  className={`text-2xl leading-none transition-transform hover:scale-110 ${
                    rating != null && n <= rating ? "text-amber-500" : "text-gray-300"
                  }`} title={`${n} star${n > 1 ? "s" : ""}`}>★</button>
              ))}
              {rating != null && (
                <button onClick={() => setRating(null)} className="ml-1 text-[11px] text-gray-400 hover:text-gray-600">clear</button>
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
                <button onClick={removeMine} className="text-[11px] text-gray-400 hover:text-red-500">Delete</button>
              )}
            </div>
          </div>

          {/* Everyone else's reviews */}
          {reviews === null ? (
            <div className="flex items-center justify-center py-6">
              <div className="h-5 w-5 rounded-full border-2 border-[#1B3829] border-t-transparent animate-spin" />
            </div>
          ) : others.length === 0 ? (
            <p className="text-[13px] text-gray-400 text-center py-2">
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
