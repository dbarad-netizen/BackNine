/**
 * HealthKit sync service — native iOS auto-sync from Apple Health.
 *
 * David 2026-08-03: replaces the XML-upload testing hack. When
 * running inside the Capacitor iOS build, this module:
 *   1. Detects HealthKit availability (returns false on web / Android)
 *   2. Prompts for read authorization on the metrics we care about
 *   3. Pulls a rolling window on app open and on a background timer
 *   4. Aggregates per day and POSTs to /api/apple-health/import-aggregated
 *      (same endpoint the client-side XML parser uses)
 *
 * Design principles:
 *   - Web-safe: every call is guarded by isAvailable(). Import of the
 *     native plugin is dynamic so the web bundle doesn't pull in
 *     iOS-only code.
 *   - Idempotent: sync writes are upserts on (user_id, date), so the
 *     same day being pulled 5 times per day just refreshes the row.
 *   - Reasonable defaults: read the last 7 days on every open, the
 *     last 30 on first-ever authorize (backfill). No infinite history
 *     scan — the user's XML import (or Health Auto Export) is the
 *     path for deep history.
 *   - Silent-fail: if HealthKit permissions are revoked or the sync
 *     errors out, we log and move on. Never blocks app render.
 *
 * Plugin choice: @perfood/capacitor-healthkit. Actively maintained,
 * TypeScript-native, supports every metric we need. Alternatives
 * considered:
 *   - capacitor-health (react-native, wrong framework)
 *   - Hand-rolled Swift plugin (too much maintenance for v1)
 *
 * See docs/app-store/README.md for the Xcode + Info.plist setup.
 */

// ── Metric mapping ──────────────────────────────────────────────────────
//
// Plugin sample name → our canonical apple_health_daily field + aggregation.
// Strategies mirror the server + client-XML parsers:
//   sum     : StepCount, ActiveEnergyBurned
//   avg     : HRV, RestingHR, RespiratoryRate, SpO2
//   latest  : VO2Max, BodyMass, BodyFat, BMI, BP, LeanMass
//   duration: SleepAnalysis (hours in bed / stage)

type Strategy = "sum" | "avg" | "latest" | "duration";

interface MetricConfig {
  plugin:  string;        // Plugin's sampleName argument
  field:   string;        // apple_health_daily column
  strategy: Strategy;
  unit?:   "kg" | "lb" | "pct" | "count" | "kcal" | "bpm" | "ms" | "mmHg" | "ml/kg/min" | "br/min";
}

const METRICS: MetricConfig[] = [
  { plugin: "stepCount",                    field: "steps",                    strategy: "sum",    unit: "count" },
  { plugin: "activeEnergyBurned",           field: "active_calories",          strategy: "sum",    unit: "kcal"  },
  { plugin: "restingHeartRate",             field: "resting_hr",               strategy: "avg",    unit: "bpm"   },
  { plugin: "heartRateVariability",         field: "hrv",                      strategy: "avg",    unit: "ms"    },
  { plugin: "respiratoryRate",              field: "respiratory_rate",         strategy: "avg",    unit: "br/min"},
  { plugin: "oxygenSaturation",             field: "spo2",                     strategy: "avg",    unit: "pct"   },
  { plugin: "vo2Max",                       field: "vo2_max",                  strategy: "latest", unit: "ml/kg/min" },
  { plugin: "weight",                       field: "weight_kg",                strategy: "latest", unit: "kg"    },
  { plugin: "bodyFatPercentage",            field: "body_fat_percentage",      strategy: "latest", unit: "pct"   },
  { plugin: "bloodPressureSystolic",        field: "blood_pressure_systolic",  strategy: "latest", unit: "mmHg"  },
  { plugin: "bloodPressureDiastolic",       field: "blood_pressure_diastolic", strategy: "latest", unit: "mmHg"  },
  { plugin: "sleepAnalysis",                field: "sleep_hours",              strategy: "duration" },
];


// ── Availability + platform detection ────────────────────────────────────

interface CapacitorGlobal {
  getPlatform(): string;
  isNativePlatform(): boolean;
}

function getCapacitor(): CapacitorGlobal | null {
  if (typeof window === "undefined") return null;
  const c = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  return c ?? null;
}

export function isCapacitorNative(): boolean {
  const c = getCapacitor();
  return !!c && c.isNativePlatform();
}

export function isIos(): boolean {
  const c = getCapacitor();
  return !!c && c.getPlatform() === "ios";
}

// Runtime access to the plugin — sidesteps TypeScript module resolution
// and Vercel bundling issues. The Capacitor iOS shim registers the
// plugin globally on Capacitor.Plugins at native startup; on web,
// window.Capacitor.Plugins.CapacitorHealthkit is undefined and every
// call in this module short-circuits.
interface HealthKitPlugin {
  requestAuthorization(opts: { all: string[]; read: string[]; write: string[] }): Promise<unknown>;
  queryHKitSampleType(opts: {
    sampleName: string;
    startDate:  string;
    endDate:    string;
    limit:      number;
  }): Promise<{ resultData: unknown[] }>;
}

function getHealthKitPlugin(): HealthKitPlugin | null {
  if (typeof window === "undefined") return null;
  const plugins = (window as unknown as {
    Capacitor?: { Plugins?: { CapacitorHealthkit?: HealthKitPlugin } }
  }).Capacitor?.Plugins;
  return plugins?.CapacitorHealthkit ?? null;
}

export async function isHealthKitAvailable(): Promise<boolean> {
  if (!isIos()) return false;
  return !!getHealthKitPlugin();
}


// ── Permissions ─────────────────────────────────────────────────────────

const READ_TYPES = METRICS.map(m => m.plugin);

export interface HealthKitAuthResult {
  granted: boolean;
  error?: string;
}

export async function requestAuthorization(): Promise<HealthKitAuthResult> {
  const hk = getHealthKitPlugin();
  if (!hk) return { granted: false, error: "HealthKit not available on this device" };
  try {
    await hk.requestAuthorization({ all: [], read: READ_TYPES, write: [] });
    return { granted: true };
  } catch (e) {
    return {
      granted: false,
      error:   e instanceof Error ? e.message : "HealthKit permission request failed",
    };
  }
}


// ── Data pull ───────────────────────────────────────────────────────────

interface HKSample {
  value:      number;
  startDate:  string;
  endDate:    string;
  sourceName?: string;
  unitName?:  string;
}

async function querySampleType(
  sampleName: string,
  startISO:   string,
  endISO:     string,
): Promise<HKSample[]> {
  const hk = getHealthKitPlugin();
  if (!hk) return [];
  try {
    const res = await hk.queryHKitSampleType({
      sampleName,
      startDate: startISO,
      endDate:   endISO,
      limit:     100000,
    });
    return (res.resultData as HKSample[]) || [];
  } catch {
    // Permission not granted for this type, or type unavailable. Move on.
    return [];
  }
}


// ── Aggregation ─────────────────────────────────────────────────────────

interface Bucket {
  sum?:       number;
  n?:         number;
  latestVal?: number;
  latestTs?:  number;
}

class Aggregator {
  buckets: Map<string, Map<string, Bucket>> = new Map();

  private getBucket(date: string, field: string): Bucket {
    let day = this.buckets.get(date);
    if (!day) { day = new Map(); this.buckets.set(date, day); }
    let b = day.get(field);
    if (!b) { b = {}; day.set(field, b); }
    return b;
  }

  add(date: string, field: string, value: number, strategy: Strategy, ts: number): void {
    const b = this.getBucket(date, field);
    if (strategy === "sum") {
      b.sum = (b.sum ?? 0) + value;
    } else if (strategy === "avg") {
      b.sum = (b.sum ?? 0) + value;
      b.n   = (b.n ?? 0) + 1;
    } else if (strategy === "latest") {
      if (b.latestTs === undefined || ts > b.latestTs) {
        b.latestVal = value;
        b.latestTs  = ts;
      }
    } else if (strategy === "duration") {
      // value is duration in seconds (we compute at add time)
      b.sum = (b.sum ?? 0) + value;
    }
  }

  resolve(): Record<string, Record<string, number>> {
    const out: Record<string, Record<string, number>> = {};
    this.buckets.forEach((fields, date) => {
      const row: Record<string, number> = {};
      fields.forEach((b, field) => {
        if (b.latestVal !== undefined) {
          row[field] = b.latestVal;
        } else if (b.n !== undefined && b.n > 0) {
          row[field] = b.sum! / b.n;
        } else if (b.sum !== undefined) {
          if (field.startsWith("sleep_") && field.endsWith("_hours")) {
            row[field] = Math.round((b.sum / 3600.0) * 100) / 100;
          } else {
            row[field] = b.sum;
          }
        }
      });
      if (Object.keys(row).length > 0) out[date] = row;
    });
    return out;
  }
}

function dateKeyLocal(iso: string): string {
  // HealthKit returns ISO strings; we want the LOCAL date because
  // "the day the sample belongs to" is anchored to when the user
  // experienced it. Slicing on 'T' gives us the calendar date in the
  // device's local zone (HealthKit's samples already carry local dates).
  return iso.substring(0, 10);
}


// ── Public sync API ─────────────────────────────────────────────────────

export interface SyncResult {
  days_synced: number;
  error?:      string;
}

/**
 * Pull the last `days` days of HealthKit data, aggregate, and POST to
 * /api/apple-health/import-aggregated. Returns a summary.
 *
 * Safe to call repeatedly — the backend upserts on (user_id, date).
 */
export async function syncRecent(days = 7): Promise<SyncResult> {
  if (!(await isHealthKitAvailable())) {
    return { days_synced: 0, error: "HealthKit unavailable" };
  }

  const now = new Date();
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const endISO   = now.toISOString();
  const startISO = start.toISOString();

  const agg = new Aggregator();

  for (const m of METRICS) {
    const samples = await querySampleType(m.plugin, startISO, endISO);
    for (const s of samples) {
      const ts   = Date.parse(s.endDate || s.startDate);
      if (isNaN(ts)) continue;
      const date = dateKeyLocal(s.endDate || s.startDate);

      if (m.strategy === "duration") {
        // Sleep samples: HealthKit records overlapping intervals for the
        // SAME night (an outer "inBed" that spans the whole session, plus
        // sub-samples for asleepCore / asleepDeep / asleepREM / awake).
        // Summing every duration double- or triple-counts each minute
        // (David 2026-08-06 saw 16h 35m from a real ~7h night).
        //
        // Only count the actual-asleep stages. Our Swift plugin encodes
        // the category value as a string in `s.value` for sleep, so we
        // filter here. Everything else (inBed, awake, unknown) is
        // treated as zero-contribution — we still want to accept the
        // sample (so the day is recognized) but not add to the total.
        //
        // Notes:
        //   • "AsleepUnspecified" is the pre-iOS-16 value when the
        //     writing app didn't record stage detail. Count it.
        //   • Some apps only ever write "InBed". If we see ONLY InBed
        //     for a day (no asleep* samples at all), that day's sleep
        //     total will be 0 — which is correct, we don't know how
        //     much was actual sleep vs. lying in bed. In practice
        //     Oura + Apple Watch both write asleep* stages.
        const stage = (s as unknown as { value?: string | number }).value;
        const stageStr = typeof stage === "string" ? stage : "";
        const isAsleep =
          stageStr === "HKCategoryValueSleepAnalysisAsleepCore" ||
          stageStr === "HKCategoryValueSleepAnalysisAsleepDeep" ||
          stageStr === "HKCategoryValueSleepAnalysisAsleepREM" ||
          stageStr === "HKCategoryValueSleepAnalysisAsleepUnspecified";
        if (!isAsleep) continue;

        const startTs = Date.parse(s.startDate);
        if (isNaN(startTs)) continue;
        const seconds = (ts - startTs) / 1000;
        if (seconds <= 0) continue;
        agg.add(date, m.field, seconds, "duration", ts);
      } else {
        let val = s.value;
        // Unit normalization mirrors the XML parser
        if (m.field === "body_fat_percentage" && val < 1) val = val * 100;
        if (m.field === "spo2" && val <= 1) val = val * 100;
        // The plugin returns weight in kg by default; if the app locale
        // returns lb the sample's unitName will say so.
        if (m.field === "weight_kg" && s.unitName === "lb") val = val * 0.45359237;
        agg.add(date, m.field, val, m.strategy, ts);
      }
    }
  }

  const daily = agg.resolve();
  if (Object.keys(daily).length === 0) {
    return { days_synced: 0 };
  }

  // POST to the same endpoint the client-side XML parser uses.
  const { api } = await import("./api");
  try {
    const r = await api.appleHealthImportAggregated(daily);
    return { days_synced: r.days_imported };
  } catch (e) {
    return {
      days_synced: 0,
      error:       e instanceof Error ? e.message : "Sync upload failed",
    };
  }
}


// ── Auto-sync scaffolding ───────────────────────────────────────────────

const AUTO_SYNC_KEY = "bn_hk_last_sync";

/** Check whether we've synced in the last N hours. */
export function isRecentSync(withinHours = 6): boolean {
  try {
    const last = localStorage.getItem(AUTO_SYNC_KEY);
    if (!last) return false;
    const ageMs = Date.now() - parseInt(last, 10);
    return ageMs < withinHours * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

/** Marker to skip redundant syncs; call this after a successful sync. */
export function markSyncedNow(): void {
  try { localStorage.setItem(AUTO_SYNC_KEY, String(Date.now())); } catch { /* ignore */ }
}

/**
 * Auto-sync entry point — call once on app open. No-ops on web, no-ops
 * if we synced recently, silent-fails on error. Never blocks render.
 */
export async function maybeAutoSync(): Promise<void> {
  if (!(await isHealthKitAvailable())) return;
  if (isRecentSync(6)) return;
  const res = await syncRecent(7);
  if (res.days_synced > 0) markSyncedNow();
}
