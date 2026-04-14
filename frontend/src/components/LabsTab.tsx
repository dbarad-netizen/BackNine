"use client";

import { useEffect, useState, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { api, type LabEntry } from "@/lib/api";

// ── Reference range metadata (mirrors backend) ────────────────────────────────
const GROUPS: Record<string, { label: string; unit: string; low: number; high: number; opt_lo: number; opt_hi: number; key: string }[]> = {
  Metabolic: [
    { key: "glucose",           label: "Fasting Glucose",   unit: "mg/dL", low: 70,   high: 99,   opt_lo: 72,  opt_hi: 90  },
    { key: "hba1c",             label: "HbA1c",             unit: "%",     low: 4.0,  high: 5.6,  opt_lo: 4.5, opt_hi: 5.4 },
    { key: "insulin",           label: "Fasting Insulin",   unit: "µIU/mL",low: 2.0,  high: 19.6, opt_lo: 2.0, opt_hi: 6.0 },
  ],
  Lipids: [
    { key: "total_cholesterol", label: "Total Cholesterol", unit: "mg/dL", low: 100,  high: 199,  opt_lo: 150, opt_hi: 180 },
    { key: "ldl",               label: "LDL",               unit: "mg/dL", low: 0,    high: 99,   opt_lo: 50,  opt_hi: 80  },
    { key: "hdl",               label: "HDL",               unit: "mg/dL", low: 40,   high: 999,  opt_lo: 60,  opt_hi: 999 },
    { key: "triglycerides",     label: "Triglycerides",     unit: "mg/dL", low: 0,    high: 149,  opt_lo: 0,   opt_hi: 100 },
  ],
  Thyroid: [
    { key: "tsh",               label: "TSH",               unit: "mIU/L", low: 0.45, high: 4.5,  opt_lo: 1.0, opt_hi: 2.5 },
    { key: "t3_free",           label: "Free T3",           unit: "pg/mL", low: 2.0,  high: 4.4,  opt_lo: 3.0, opt_hi: 4.0 },
    { key: "t4_free",           label: "Free T4",           unit: "ng/dL", low: 0.82, high: 1.77, opt_lo: 1.0, opt_hi: 1.5 },
  ],
  Hormones: [
    { key: "testosterone_total",label: "Total Testosterone",unit: "ng/dL", low: 300,  high: 1000, opt_lo: 550, opt_hi: 900 },
    { key: "testosterone_free", label: "Free Testosterone", unit: "pg/mL", low: 9.0,  high: 30.0, opt_lo: 15,  opt_hi: 25  },
    { key: "estradiol",         label: "Estradiol (E2)",    unit: "pg/mL", low: 10,   high: 40,   opt_lo: 20,  opt_hi: 30  },
    { key: "dhea_s",            label: "DHEA-S",            unit: "µg/dL", low: 100,  high: 500,  opt_lo: 200, opt_hi: 400 },
    { key: "cortisol",          label: "AM Cortisol",       unit: "µg/dL", low: 6.0,  high: 23.0, opt_lo: 10,  opt_hi: 18  },
  ],
  Inflammation: [
    { key: "crp_hs",            label: "hsCRP",             unit: "mg/L",  low: 0,    high: 1.0,  opt_lo: 0,   opt_hi: 0.5 },
    { key: "homocysteine",      label: "Homocysteine",      unit: "µmol/L",low: 0,    high: 10.4, opt_lo: 0,   opt_hi: 7.0 },
  ],
  Blood: [
    { key: "ferritin",          label: "Ferritin",          unit: "ng/mL", low: 30,   high: 400,  opt_lo: 70,  opt_hi: 200 },
    { key: "hemoglobin",        label: "Hemoglobin",        unit: "g/dL",  low: 13.5, high: 17.5, opt_lo: 14,  opt_hi: 17  },
    { key: "hematocrit",        label: "Hematocrit",        unit: "%",     low: 38.3, high: 50.3, opt_lo: 42,  opt_hi: 48  },
  ],
  Vitamins: [
    { key: "vitamin_d",         label: "Vitamin D (25-OH)", unit: "ng/mL", low: 30,   high: 100,  opt_lo: 50,  opt_hi: 80  },
    { key: "vitamin_b12",       label: "Vitamin B12",       unit: "pg/mL", low: 200,  high: 900,  opt_lo: 500, opt_hi: 900 },
    { key: "magnesium",         label: "Magnesium",         unit: "mg/dL", low: 1.7,  high: 2.2,  opt_lo: 2.0, opt_hi: 2.2 },
    { key: "zinc",              label: "Zinc",              unit: "µg/dL", low: 60,   high: 120,  opt_lo: 80,  opt_hi: 110 },
  ],
  "Kidney/Liver": [
    { key: "creatinine",        label: "Creatinine",        unit: "mg/dL", low: 0.74, high: 1.35, opt_lo: 0.9,  opt_hi: 1.2  },
    { key: "egfr",              label: "eGFR",              unit: "mL/min",low: 60,   high: 999,  opt_lo: 90,   opt_hi: 999  },
    { key: "bun",               label: "BUN",               unit: "mg/dL", low: 6,    high: 24,   opt_lo: 10,   opt_hi: 18   },
    { key: "bun_creatinine_ratio", label: "BUN/Creat Ratio",unit: "",      low: 9,    high: 20,   opt_lo: 10,   opt_hi: 16   },
    { key: "alt",               label: "ALT",               unit: "U/L",   low: 0,    high: 40,   opt_lo: 0,    opt_hi: 25   },
    { key: "ast",               label: "AST",               unit: "U/L",   low: 0,    high: 40,   opt_lo: 0,    opt_hi: 25   },
    { key: "alkaline_phosphatase", label: "Alk Phosphatase",unit: "IU/L",  low: 44,   high: 123,  opt_lo: 50,   opt_hi: 80   },
    { key: "bilirubin_total",   label: "Bilirubin, Total",  unit: "mg/dL", low: 0,    high: 1.2,  opt_lo: 0.4,  opt_hi: 0.9  },
  ],
  "Electrolytes": [
    { key: "sodium",            label: "Sodium",            unit: "mmol/L",low: 134,  high: 144,  opt_lo: 136,  opt_hi: 142  },
    { key: "potassium",         label: "Potassium",         unit: "mmol/L",low: 3.5,  high: 5.2,  opt_lo: 4.0,  opt_hi: 4.5  },
    { key: "chloride",          label: "Chloride",          unit: "mmol/L",low: 96,   high: 106,  opt_lo: 100,  opt_hi: 106  },
    { key: "co2",               label: "CO2 (Bicarb)",      unit: "mmol/L",low: 20,   high: 29,   opt_lo: 24,   opt_hi: 28   },
    { key: "calcium",           label: "Calcium",           unit: "mg/dL", low: 8.7,  high: 10.2, opt_lo: 9.2,  opt_hi: 9.8  },
    { key: "protein_total",     label: "Protein, Total",    unit: "g/dL",  low: 6.0,  high: 8.5,  opt_lo: 6.9,  opt_hi: 7.4  },
    { key: "albumin",           label: "Albumin",           unit: "g/dL",  low: 3.8,  high: 4.9,  opt_lo: 4.2,  opt_hi: 4.8  },
    { key: "globulin",          label: "Globulin",          unit: "g/dL",  low: 1.5,  high: 4.5,  opt_lo: 2.0,  opt_hi: 3.0  },
  ],
  "CBC": [
    { key: "wbc",               label: "WBC",               unit: "x10³/µL",low: 3.4, high: 10.8, opt_lo: 5.0,  opt_hi: 7.0  },
    { key: "rbc",               label: "RBC",               unit: "x10⁶/µL",low: 4.14,high: 5.80, opt_lo: 4.5,  opt_hi: 5.3  },
    { key: "mcv",               label: "MCV",               unit: "fL",    low: 79,   high: 97,   opt_lo: 82,   opt_hi: 90   },
    { key: "mch",               label: "MCH",               unit: "pg",    low: 26.6, high: 33.0, opt_lo: 28,   opt_hi: 32   },
    { key: "mchc",              label: "MCHC",              unit: "g/dL",  low: 31.5, high: 35.7, opt_lo: 33,   opt_hi: 35   },
    { key: "rdw",               label: "RDW",               unit: "%",     low: 11.6, high: 15.4, opt_lo: 11.6, opt_hi: 13.0 },
    { key: "platelets",         label: "Platelets",         unit: "x10³/µL",low: 150, high: 450,  opt_lo: 200,  opt_hi: 350  },
  ],
  "Iron": [
    { key: "iron_serum",        label: "Iron, Serum",       unit: "µg/dL", low: 38,   high: 169,  opt_lo: 60,   opt_hi: 130  },
    { key: "tibc",              label: "TIBC",              unit: "µg/dL", low: 250,  high: 450,  opt_lo: 250,  opt_hi: 370  },
    { key: "uibc",              label: "UIBC",              unit: "µg/dL", low: 111,  high: 343,  opt_lo: 150,  opt_hi: 300  },
    { key: "iron_saturation",   label: "Iron Saturation",   unit: "%",     low: 15,   high: 55,   opt_lo: 25,   opt_hi: 35   },
  ],
  "Other": [
    { key: "psa",               label: "PSA",               unit: "ng/mL", low: 0,    high: 4.0,  opt_lo: 0,    opt_hi: 2.0  },
    { key: "apolipoprotein_b",  label: "Apolipoprotein B",  unit: "mg/dL", low: 0,    high: 90,   opt_lo: 0,    opt_hi: 80   },
    { key: "vldl",              label: "VLDL Cholesterol",  unit: "mg/dL", low: 5,    high: 40,   opt_lo: 5,    opt_hi: 20   },
  ],
};

const ALL_MARKERS = Object.values(GROUPS).flat();

function statusFor(key: string, val: number) {
  const ref = ALL_MARKERS.find(m => m.key === key);
  if (!ref) return "normal";
  if (val < ref.low)  return "low";
  if (val > ref.high) return "high";
  if (val >= ref.opt_lo && val <= ref.opt_hi) return "optimal";
  return "normal";
}

const STATUS_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  optimal: { bg: "bg-green-50  border border-green-200",  text: "text-green-700",  label: "Optimal" },
  normal:  { bg: "bg-gray-50   border border-gray-200",   text: "text-gray-600",   label: "Normal"  },
  low:     { bg: "bg-amber-50  border border-amber-200",  text: "text-amber-700",  label: "Low"     },
  high:    { bg: "bg-red-50    border border-red-200",    text: "text-red-700",    label: "High"    },
};

// ── Mini spark-line for a single marker ───────────────────────────────────────
function MarkerTrend({
  markerKey, entries,
}: { markerKey: string; entries: LabEntry[] }) {
  const ref = ALL_MARKERS.find(m => m.key === markerKey);
  if (!ref) return null;

  const points = entries
    .filter(e => (e as unknown as Record<string, unknown>)[markerKey] != null)
    .map(e => ({
      date:  e.date.slice(5),   // MM-DD
      value: (e as unknown as Record<string, unknown>)[markerKey] as number,
    }));

  if (points.length < 2) return null;

  const color = statusFor(markerKey, points[points.length - 1].value) === "optimal"
    ? "#22c55e"
    : statusFor(markerKey, points[points.length - 1].value) === "normal"
    ? "#6B7280"
    : statusFor(markerKey, points[points.length - 1].value) === "low"
    ? "#f59e0b"
    : "#ef4444";

  return (
    <div className="h-12 mt-1">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
          <XAxis dataKey="date" hide />
          <YAxis domain={["auto", "auto"]} hide />
          <Tooltip
            contentStyle={{ background: "#FFFFFF", border: "1px solid #3f3f46", borderRadius: 8, fontSize: 11 }}
            labelStyle={{ color: "#6B7280" }}
            itemStyle={{ color: "#111827" }}
          />
          {ref.opt_lo > 0 && ref.opt_hi < 990 && (
            <ReferenceLine y={ref.opt_lo} stroke="#22c55e" strokeDasharray="2 3" strokeOpacity={0.35} />
          )}
          {ref.opt_hi < 990 && (
            <ReferenceLine y={ref.opt_hi} stroke="#22c55e" strokeDasharray="2 3" strokeOpacity={0.35} />
          )}
          <Line type="monotone" dataKey="value" stroke={color} dot={{ r: 2, fill: color }} strokeWidth={1.5} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Log form ──────────────────────────────────────────────────────────────────
interface LogFormProps {
  onSave: (entry: Partial<LabEntry> & { date: string }) => Promise<void>;
}
function LabLogForm({ onSave }: LogFormProps) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [values, setValues] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [activeGroup, setActiveGroup] = useState<string>("Metabolic");

  const set = (key: string, val: string) =>
    setValues(prev => ({ ...prev, [key]: val }));

  const handleSave = async () => {
    const parsed: Record<string, number> = {};
    for (const [k, v] of Object.entries(values)) {
      const n = parseFloat(v);
      if (!isNaN(n)) parsed[k] = n;
    }
    if (Object.keys(parsed).length === 0) return;
    setSaving(true);
    try {
      await onSave({ date, notes, ...parsed });
      setValues({});
      setNotes("");
    } finally {
      setSaving(false);
    }
  };

  const markers = GROUPS[activeGroup] ?? [];

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-4">
      <p className="text-sm font-semibold text-gray-900">Log Lab Results</p>

      {/* Date */}
      <div>
        <label className="block text-xs text-gray-500 mb-1">Date</label>
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          className="w-full bg-gray-100 border border-gray-300 rounded-lg px-3 py-2 text-sm text-white" />
      </div>

      {/* Group tabs */}
      <div className="flex flex-wrap gap-1">
        {Object.keys(GROUPS).map(g => (
          <button key={g} onClick={() => setActiveGroup(g)}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
              activeGroup === g ? "bg-gray-200 text-white" : "text-gray-400 hover:text-gray-700"
            }`}>
            {g}
          </button>
        ))}
      </div>

      {/* Marker inputs */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        {markers.map(m => (
          <div key={m.key}>
            <label className="block text-xs text-gray-500 mb-1">
              {m.label} <span className="text-gray-400">({m.unit})</span>
            </label>
            <input
              type="number" step="any"
              value={values[m.key] ?? ""}
              onChange={e => set(m.key, e.target.value)}
              placeholder={`${m.opt_lo}–${m.opt_hi}`}
              className="w-full bg-gray-100 border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
            />
          </div>
        ))}
      </div>

      {/* Notes */}
      <div>
        <label className="block text-xs text-gray-500 mb-1">Notes (optional)</label>
        <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
          placeholder="e.g. fasted 12 hrs"
          className="w-full bg-gray-100 border border-gray-300 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500" />
      </div>

      <button onClick={handleSave} disabled={saving}
        className="w-full py-2.5 rounded-xl bg-[#1B3829] hover:bg-[#2D6A4F] text-white text-sm font-semibold disabled:opacity-50 transition-colors">
        {saving ? "Saving…" : "Save Lab Entry"}
      </button>
    </div>
  );
}

// ── Scored marker row ─────────────────────────────────────────────────────────
function MarkerRow({
  label, value, unit, status, range, optRange,
}: {
  label: string; value: number; unit: string; status: string; range: string; optRange: string;
}) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.normal;
  return (
    <div className={`flex items-center justify-between rounded-xl px-3 py-2.5 ${s.bg}`}>
      <div>
        <p className="text-sm text-gray-900 font-medium">{label}</p>
        <p className={`text-xs mt-0.5 opacity-60 ${s.text}`}>Ref: {range} · Opt: {optRange}</p>
      </div>
      <div className="text-right">
        <span className={`text-sm font-bold ${s.text}`}>{value} <span className="text-xs font-normal opacity-70">{unit}</span></span>
        <p className={`text-xs font-semibold ${s.text}`}>{s.label}</p>
      </div>
    </div>
  );
}

// ── Single lab entry card ─────────────────────────────────────────────────────
function LabEntryCard({
  entry, allEntries, onDelete,
}: {
  entry: LabEntry; allEntries: LabEntry[]; onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  // Score every marker in this entry
  const scored: { key: string; label: string; unit: string; value: number; status: string; range: string; optRange: string }[] = [];
  for (const m of ALL_MARKERS) {
    const val = (entry as unknown as Record<string, unknown>)[m.key];
    if (val == null) continue;
    const v = val as number;
    const status = statusFor(m.key, v);
    scored.push({
      key: m.key, label: m.label, unit: m.unit, value: v, status,
      range:    `${m.low}–${m.high === 999 ? "—" : m.high} ${m.unit}`,
      optRange: `${m.opt_lo}–${m.opt_hi === 999 ? "—" : m.opt_hi} ${m.unit}`,
    });
  }

  const counts = scored.reduce<Record<string, number>>((acc, s) => {
    acc[s.status] = (acc[s.status] ?? 0) + 1; return acc;
  }, {});

  return (
    <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 cursor-pointer"
        onClick={() => setExpanded(!expanded)}>
        <div>
          <p className="text-sm font-semibold text-gray-900">{entry.date}</p>
          <div className="flex gap-2 mt-1">
            {(["optimal", "normal", "low", "high"] as const).map(s => counts[s] ? (
              <span key={s} className={`text-xs font-medium ${STATUS_STYLE[s].text}`}>
                {counts[s]} {STATUS_STYLE[s].label.toLowerCase()}
              </span>
            ) : null)}
          </div>
          {entry.notes && <p className="text-xs text-gray-400 mt-0.5">{entry.notes}</p>}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={e => { e.stopPropagation(); onDelete(entry.id); }}
            className="text-gray-400 hover:text-red-400 transition-colors text-lg leading-none px-1">×</button>
          <span className="text-gray-400 text-sm">{expanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 space-y-4">
          {Object.entries(GROUPS).map(([groupName, markers]) => {
            const groupScored = scored.filter(s => markers.some(m => m.key === s.key));
            if (groupScored.length === 0) return null;
            return (
              <div key={groupName}>
                <p className="text-xs text-gray-400 uppercase tracking-widest mb-2">{groupName}</p>
                <div className="space-y-1.5">
                  {groupScored.map(s => (
                    <MarkerRow key={s.key} {...s} />
                  ))}
                </div>
                {/* Trend for markers with history */}
                {groupScored.map(s => (
                  <MarkerTrend key={s.key + "_trend"} markerKey={s.key} entries={allEntries} />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Summary scorecard ─────────────────────────────────────────────────────────
function LabSummary({ entries }: { entries: LabEntry[] }) {
  if (entries.length === 0) return null;
  const latest = entries[entries.length - 1];

  const scored: Record<string, string> = {};
  for (const m of ALL_MARKERS) {
    const val = (latest as unknown as Record<string, unknown>)[m.key];
    if (val != null) scored[m.key] = statusFor(m.key, val as number);
  }

  const counts = Object.values(scored).reduce<Record<string, number>>((acc, s) => {
    acc[s] = (acc[s] ?? 0) + 1; return acc;
  }, {});

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return null;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <p className="text-xs text-gray-400 uppercase tracking-widest mb-3">Latest Panel Summary</p>
      <div className="flex gap-3">
        {(["optimal", "normal", "low", "high"] as const).map(s => (
          <div key={s} className={`flex-1 text-center rounded-xl py-2.5 ${STATUS_STYLE[s].bg}`}>
            <p className={`text-2xl font-bold ${STATUS_STYLE[s].text}`}>{counts[s] ?? 0}</p>
            <p className="text-xs text-gray-400 mt-0.5 capitalize">{s}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-400 mt-2 text-center">{total} markers tracked · {latest.date}</p>
    </div>
  );
}

// ── PDF import preview panel ──────────────────────────────────────────────────
interface PdfPreview {
  date: string;
  extracted: Record<string, number>;
  count: number;
}

function PdfImportPanel({ onConfirm, onCancel }: {
  onConfirm: (date: string, values: Record<string, number>, notes: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<PdfPreview | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const processFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("Please upload a PDF file.");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const result = await api.importLabPdf(file);
      setPreview(result);
      setEditDate(result.date);
      const init: Record<string, string> = {};
      for (const [k, v] of Object.entries(result.extracted)) {
        init[k] = String(v);
      }
      setEditValues(init);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Parse error: ${msg}`);
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const handleConfirm = async () => {
    if (!preview) return;
    setSaving(true);
    const vals: Record<string, number> = {};
    for (const [k, v] of Object.entries(editValues)) {
      const n = parseFloat(v);
      if (!isNaN(n)) vals[k] = n;
    }
    await onConfirm(editDate, vals, notes);
    setSaving(false);
  };

  if (!preview) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-900">Import from PDF</p>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>

        {/* Drop zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed py-10 transition-all cursor-pointer ${
            dragging ? "border-cyan-500 bg-cyan-500/10" : "border-gray-300 hover:border-zinc-500"
          }`}
        >
          <input type="file" accept=".pdf" onChange={handleFileInput}
            className="absolute inset-0 opacity-0 cursor-pointer" />
          {uploading ? (
            <p className="text-sm text-gray-500">Parsing PDF…</p>
          ) : (
            <>
              <span className="text-3xl">📄</span>
              <p className="text-sm text-gray-700 font-medium">Drop your lab PDF here</p>
              <p className="text-xs text-gray-400">or click to browse · Quest, LabCorp, hospital portals</p>
            </>
          )}
        </div>

        {error && <p className="text-xs text-red-400 text-center">{error}</p>}

        <p className="text-xs text-gray-400 text-center">
          Your PDF is sent securely to BackNine for extraction and saved to your account.
        </p>
      </div>
    );
  }

  // Preview / edit step
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-900">Review extracted results</p>
          <p className="text-xs text-gray-400 mt-0.5">{preview.count} marker{preview.count !== 1 ? "s" : ""} found</p>
        </div>
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
      </div>

      {/* Date */}
      <div>
        <label className="block text-xs text-gray-500 mb-1">Date</label>
        <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)}
          className="w-full bg-gray-100 border border-gray-300 rounded-lg px-3 py-2 text-sm text-white" />
      </div>

      {/* Extracted values — grouped */}
      {Object.entries(GROUPS).map(([groupName, markers]) => {
        const found = markers.filter(m => editValues[m.key] !== undefined);
        if (found.length === 0) return null;
        return (
          <div key={groupName}>
            <p className="text-xs text-gray-400 uppercase tracking-widest mb-2">{groupName}</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {found.map(m => {
                const val = parseFloat(editValues[m.key] ?? "");
                const status = !isNaN(val) ? statusFor(m.key, val) : "normal";
                const s = STATUS_STYLE[status];
                return (
                  <div key={m.key}>
                    <label className="block text-xs text-gray-500 mb-1">
                      {m.label} <span className="text-gray-400">({m.unit})</span>
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number" step="any"
                        value={editValues[m.key] ?? ""}
                        onChange={e => setEditValues(prev => ({ ...prev, [m.key]: e.target.value }))}
                        className="flex-1 bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-[#1B3829]"
                      />
                      <span className={`text-xs font-semibold shrink-0 ${s.text}`}>{s.label}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {preview.count === 0 && (
        <p className="text-sm text-amber-400 text-center py-2">
          No markers were automatically detected. This PDF may use unusual formatting — try the manual entry form instead.
        </p>
      )}

      {/* Notes */}
      <div>
        <label className="block text-xs text-gray-500 mb-1">Notes (optional)</label>
        <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
          placeholder="e.g. fasted 12 hrs, Quest Diagnostics"
          className="w-full bg-gray-100 border border-gray-300 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500" />
      </div>

      <div className="flex gap-2">
        <button onClick={onCancel}
          className="flex-1 py-2.5 rounded-xl border border-gray-300 text-gray-500 hover:text-white text-sm font-medium transition-colors">
          Cancel
        </button>
        <button onClick={handleConfirm} disabled={saving || preview.count === 0}
          className="flex-1 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold disabled:opacity-50 transition-colors">
          {saving ? "Saving…" : `Save ${Object.keys(editValues).length} markers`}
        </button>
      </div>
    </div>
  );
}

// ── Main LabsTab component ────────────────────────────────────────────────────
type InputMode = "none" | "pdf" | "manual";

export default function LabsTab() {
  const [entries, setEntries] = useState<LabEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [inputMode, setInputMode] = useState<InputMode>("none");

  const load = useCallback(async () => {
    try {
      const { entries: e } = await api.labEntries();
      setEntries(e);
    } catch (err) {
      console.error("Labs load error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleManualSave = async (entry: Partial<LabEntry> & { date: string }) => {
    await api.logLab(entry);
    await load();
    setInputMode("none");
  };

  const handlePdfConfirm = async (date: string, values: Record<string, number>, notes: string) => {
    await api.logLab({ date, notes, ...values } as Partial<LabEntry> & { date: string });
    await load();
    setInputMode("none");
  };

  const handleDelete = async (id: string) => {
    await api.deleteLab(id);
    setEntries(prev => prev.filter(e => e.id !== id));
  };

  if (loading) {
    return <div className="text-center py-16 text-gray-400 text-sm">Loading labs…</div>;
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      <LabSummary entries={entries} />

      {/* Import / entry buttons */}
      {inputMode === "none" && (
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setInputMode("pdf")}
            className="flex items-center justify-center gap-2 py-3 rounded-xl bg-[#1B3829] text-white hover:bg-[#2D6A4F] text-sm font-medium transition-all"
          >
            <span>📄</span> Import PDF
          </button>
          <button
            onClick={() => setInputMode("manual")}
            className="flex items-center justify-center gap-2 py-3 rounded-xl border border-gray-200 bg-white text-gray-600 hover:text-gray-900 hover:border-gray-300 text-sm font-medium transition-all"
          >
            <span>✎</span> Manual entry
          </button>
        </div>
      )}

      {/* PDF import panel */}
      {inputMode === "pdf" && (
        <PdfImportPanel
          onConfirm={handlePdfConfirm}
          onCancel={() => setInputMode("none")}
        />
      )}

      {/* Manual form */}
      {inputMode === "manual" && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={() => setInputMode("none")}
              className="text-xs text-gray-400 hover:text-gray-700 transition-colors">
              ✕ Cancel
            </button>
          </div>
          <LabLogForm onSave={handleManualSave} />
        </div>
      )}

      {/* History */}
      {entries.length === 0 && inputMode === "none" ? (
        <div className="text-center py-12 text-gray-400 text-sm">
          No lab results yet. Import a PDF or enter values manually above.
        </div>
      ) : (
        <div className="space-y-3">
          {[...entries].reverse().map(e => (
            <LabEntryCard key={e.id} entry={e} allEntries={entries} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  );
}
