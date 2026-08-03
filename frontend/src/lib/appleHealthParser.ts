/**
 * Apple Health export parser — RUNS IN THE BROWSER.
 *
 * David 2026-07-30: uploading a 194 MB export.zip to Render was 502ing
 * because Render's request timeout (100s default) is shorter than the
 * upload takes. Solution: parse the zip locally in the browser,
 * aggregate per-day metrics, and only POST the resulting ~200 KB JSON
 * to the backend. The backend endpoint just batched-upserts.
 *
 * The parser is a straight port of backend/apple_health_xml.py so the
 * aggregation semantics are identical:
 *   • sum-per-day       : StepCount, ActiveEnergyBurned
 *   • avg-per-day       : HRV, resting HR, respiratory rate, SpO2
 *   • latest-per-day    : VO2 max, weight, body fat, BP, BMI, waist
 *   • sleep-stage sums  : SleepAnalysis (durations by category value)
 *
 * Zip handling: dynamic-imported JSZip from a CDN so we don't add a
 * hard npm dependency. Handles the .zip case; raw .xml uploads are
 * parsed directly from the File stream.
 *
 * Memory: JSZip loads the compressed zip fully (~200 MB). It then
 * streams the inner XML in chunks — we process each chunk with a
 * buffer that only holds the current in-flight Record, so peak
 * memory during parse stays flat regardless of extracted XML size.
 */

// ── Types (mirror backend response shape) ────────────────────────────────

export interface DailyMetrics {
  [date: string]: {   // "YYYY-MM-DD"
    [field: string]: number;
  };
}

export interface ParseProgress {
  bytesProcessed: number;
  recordsSeen:    number;
  daysAccumulated: number;
}

export type ProgressCallback = (p: ParseProgress) => void;


// ── Metric mapping (identical to backend/apple_health_xml.py) ────────────

type Strategy = "sum" | "avg" | "latest" | "sleep";

const TYPE_MAP: Record<string, [string, Strategy]> = {
  HKQuantityTypeIdentifierStepCount:                ["steps",                     "sum"],
  HKQuantityTypeIdentifierActiveEnergyBurned:       ["active_calories",           "sum"],
  HKQuantityTypeIdentifierRestingHeartRate:         ["resting_hr",                "avg"],
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN: ["hrv",                       "avg"],
  HKQuantityTypeIdentifierRespiratoryRate:          ["respiratory_rate",          "avg"],
  HKQuantityTypeIdentifierOxygenSaturation:         ["spo2",                      "avg"],
  HKQuantityTypeIdentifierVO2Max:                   ["vo2_max",                   "latest"],
  HKQuantityTypeIdentifierBodyMass:                 ["weight_kg",                 "latest"],
  HKQuantityTypeIdentifierBodyFatPercentage:        ["body_fat_percentage",       "latest"],
  HKQuantityTypeIdentifierLeanBodyMass:             ["lean_body_mass_kg",         "latest"],
  HKQuantityTypeIdentifierBodyMassIndex:            ["bmi",                       "latest"],
  HKQuantityTypeIdentifierWaistCircumference:       ["waist_circumference_cm",    "latest"],
  HKQuantityTypeIdentifierBloodPressureSystolic:    ["blood_pressure_systolic",   "latest"],
  HKQuantityTypeIdentifierBloodPressureDiastolic:   ["blood_pressure_diastolic",  "latest"],
  HKCategoryTypeIdentifierSleepAnalysis:            ["__sleep__",                 "sleep"],
};

const SLEEP_STAGE_MAP: Record<string, string> = {
  HKCategoryValueSleepAnalysisAsleepDeep:        "sleep_deep_hours",
  HKCategoryValueSleepAnalysisAsleepREM:         "sleep_rem_hours",
  HKCategoryValueSleepAnalysisAsleepCore:        "sleep_core_hours",
  HKCategoryValueSleepAnalysisAsleepUnspecified: "sleep_core_hours",
  HKCategoryValueSleepAnalysisInBed:             "sleep_hours",
  HKCategoryValueSleepAnalysisAwake:             "sleep_awake_hours",
};

// Weight/length unit conversions — Apple's `unit` attribute varies by
// user locale. We normalize to metric on ingest so the backend never
// has to think about it.
const UNIT_CONVERT: Record<string, Record<string, number>> = {
  weight_kg: {
    kg:  1.0,
    lb:  0.45359237,
    lbs: 0.45359237,
    g:   0.001,
    st:  6.35029318,
  },
  waist_circumference_cm: {
    cm: 1.0,
    in: 2.54,
    m:  100.0,
  },
};


// ── Aggregator ──────────────────────────────────────────────────────────

interface Bucket {
  sum?:       number;
  n?:         number;
  latestVal?: number;
  latestTs?:  number;    // epoch ms
}

class Aggregator {
  buckets: Map<string, Map<string, Bucket>> = new Map();

  private getDay(date: string): Map<string, Bucket> {
    let day = this.buckets.get(date);
    if (!day) {
      day = new Map();
      this.buckets.set(date, day);
    }
    return day;
  }

  private getBucket(date: string, field: string): Bucket {
    const day = this.getDay(date);
    let b = day.get(field);
    if (!b) {
      b = {};
      day.set(field, b);
    }
    return b;
  }

  addSum(date: string, field: string, value: number): void {
    const b = this.getBucket(date, field);
    b.sum = (b.sum ?? 0) + value;
  }

  addAvg(date: string, field: string, value: number): void {
    const b = this.getBucket(date, field);
    b.sum = (b.sum ?? 0) + value;
    b.n   = (b.n ?? 0) + 1;
  }

  addLatest(date: string, field: string, value: number, ts: number): void {
    const b = this.getBucket(date, field);
    if (b.latestTs === undefined || ts > b.latestTs) {
      b.latestVal = value;
      b.latestTs  = ts;
    }
  }

  addDuration(date: string, field: string, seconds: number): void {
    const b = this.getBucket(date, field);
    b.sum = (b.sum ?? 0) + seconds;
  }

  resolve(): DailyMetrics {
    const out: DailyMetrics = {};
    this.buckets.forEach((fields, date) => {
      const row: Record<string, number> = {};
      fields.forEach((b, field) => {
        if (b.latestVal !== undefined) {
          row[field] = b.latestVal;
        } else if (b.n !== undefined && b.n > 0) {
          row[field] = b.sum! / b.n;
        } else if (b.sum !== undefined) {
          // sleep-stage sums are seconds → convert to hours
          if (field.startsWith("sleep_") && field.endsWith("_hours")) {
            row[field] = Math.round((b.sum / 3600.0) * 100) / 100;
          } else {
            row[field] = b.sum;
          }
        }
      });
      if (Object.keys(row).length > 0) {
        out[date] = row;
      }
    });
    return out;
  }

  size(): number {
    return this.buckets.size;
  }
}


// ── Record processing ───────────────────────────────────────────────────

// Regex to pull attributes out of a self-closing <Record .../> tag.
// Attributes we care about: type, value, unit, startDate, endDate.
const ATTR_RE = /(type|value|unit|startDate|endDate)="([^"]*)"/g;

function parseRecordAttrs(recordText: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  let m: RegExpExecArray | null;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(recordText)) !== null) {
    attrs[m[1]] = m[2];
  }
  return attrs;
}

function parseDateLocal(v: string | undefined): string | null {
  // Apple format: "2026-07-15 08:34:11 -0700" — first token is the date
  if (!v) return null;
  const idx = v.indexOf(" ");
  return idx > 0 ? v.substring(0, idx) : v;
}

function parseTsEpoch(v: string | undefined): number | null {
  if (!v) return null;
  // Convert "2026-07-15 08:34:11 -0700" → "2026-07-15T08:34:11-0700"
  const iso = v.replace(" ", "T").replace(/ ([-+]\d{2})(\d{2})$/, "$1:$2");
  const t = Date.parse(iso);
  return isNaN(t) ? null : t;
}

function processRecord(recordText: string, agg: Aggregator): boolean {
  const attrs = parseRecordAttrs(recordText);
  const hkType = attrs.type;
  if (!hkType) return false;
  const map = TYPE_MAP[hkType];
  if (!map) return false;
  const [field, strategy] = map;

  const dateKey = parseDateLocal(attrs.endDate || attrs.startDate);
  if (!dateKey) return false;

  if (strategy === "sleep") {
    const start = parseTsEpoch(attrs.startDate);
    const end   = parseTsEpoch(attrs.endDate);
    const stageField = SLEEP_STAGE_MAP[attrs.value || ""];
    if (!stageField || start === null || end === null) return false;
    const seconds = (end - start) / 1000;
    if (seconds <= 0) return false;
    agg.addDuration(dateKey, stageField, seconds);
    return true;
  }

  const raw = attrs.value;
  if (raw === undefined) return false;
  let val = parseFloat(raw);
  if (!isFinite(val)) return false;

  // Unit normalization for fields that vary by user locale
  const unit = (attrs.unit || "").trim();
  if (unit && UNIT_CONVERT[field] && UNIT_CONVERT[field][unit] !== undefined) {
    val = val * UNIT_CONVERT[field][unit];
  }
  // Apple stores body_fat_percentage as fraction (0.14 = 14%). Detect
  // and rescale if we get a value < 1 for a percent field.
  if (field === "body_fat_percentage" && val < 1) {
    val = val * 100;
  }
  // SpO2 also comes as fraction if unit is % — Apple's convention.
  if (field === "spo2" && val <= 1) {
    val = val * 100;
  }

  if (strategy === "sum") {
    agg.addSum(dateKey, field, val);
  } else if (strategy === "avg") {
    agg.addAvg(dateKey, field, val);
  } else if (strategy === "latest") {
    const ts = parseTsEpoch(attrs.endDate || attrs.startDate);
    if (ts !== null) agg.addLatest(dateKey, field, val, ts);
  }
  return true;
}


// ── Streaming parser: consume text chunks, emit records ─────────────────

interface StreamState {
  buffer:  string;
  agg:     Aggregator;
  records: number;
}

function feedChunk(text: string, state: StreamState): void {
  state.buffer += text;
  // Find all self-closing <Record .../> tags in the buffer.
  // Apple's export uses self-closing form for Record (attributes only).
  // Correlations wrap multiple Records — we still catch them individually.
  let searchFrom = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const openIdx = state.buffer.indexOf("<Record", searchFrom);
    if (openIdx === -1) break;
    // Find the CLOSING '/>' or '>' for this Record. Records in Apple's
    // export are usually self-closing '/>', but occasionally contain
    // nested MetadataEntry children in which case the closer is '>'
    // followed later by '</Record>'.
    const selfClose = state.buffer.indexOf("/>", openIdx);
    const openClose = state.buffer.indexOf(">", openIdx);
    const fullClose = state.buffer.indexOf("</Record>", openIdx);
    // Prefer the self-closing form if it's before the open-close
    if (selfClose !== -1 && (openClose === -1 || selfClose <= openClose)) {
      const record = state.buffer.substring(openIdx, selfClose + 2);
      if (processRecord(record, state.agg)) state.records++;
      searchFrom = selfClose + 2;
      continue;
    }
    // Non-self-closing Record with children — need the '</Record>'
    if (fullClose !== -1) {
      const record = state.buffer.substring(openIdx, openClose + 1);
      if (processRecord(record, state.agg)) state.records++;
      searchFrom = fullClose + "</Record>".length;
      continue;
    }
    // Incomplete Record — wait for more data
    break;
  }
  // Discard everything up to searchFrom to keep buffer small
  if (searchFrom > 0) {
    state.buffer = state.buffer.substring(searchFrom);
  }
  // Safety: if the buffer is unreasonably large (>1 MB) with no Record
  // parse, it's probably not an Apple export — bail before we OOM.
  if (state.buffer.length > 1024 * 1024) {
    // Drop everything up to the last '<' to keep bounded
    const lastOpen = state.buffer.lastIndexOf("<");
    state.buffer = lastOpen > 0 ? state.buffer.substring(lastOpen) : "";
  }
}


// ── Post-process: fill sleep_hours from stages if missing ───────────────

function fillDerived(daily: DailyMetrics): DailyMetrics {
  Object.values(daily).forEach(row => {
    if (row.sleep_hours) return;
    const stages = (row.sleep_deep_hours || 0) +
                   (row.sleep_rem_hours  || 0) +
                   (row.sleep_core_hours || 0);
    if (stages > 0) row.sleep_hours = Math.round(stages * 100) / 100;
  });
  return daily;
}


// ── Public API: parse a File (zip or xml) into DailyMetrics ─────────────

const JSZIP_CDN = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";

async function loadJSZip(): Promise<any> {
  // Load JSZip from a CDN on-demand. Avoids adding a hard npm dep for
  // a feature only used by this one flow. Caches globally after first
  // load so multiple uploads in one session skip the network round-trip.
  const w = window as any;
  if (w.JSZip) return w.JSZip;
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src   = JSZIP_CDN;
    s.async = true;
    s.onload  = () => resolve();
    s.onerror = () => reject(new Error("Couldn't load JSZip from CDN — check your network."));
    document.head.appendChild(s);
  });
  if (!w.JSZip) throw new Error("JSZip failed to attach to window after load.");
  return w.JSZip;
}

export async function parseAppleHealthFile(
  file: File,
  onProgress?: ProgressCallback,
): Promise<DailyMetrics> {
  const state: StreamState = { buffer: "", agg: new Aggregator(), records: 0 };
  const isZip = file.name.toLowerCase().endsWith(".zip") || file.type === "application/zip";

  if (isZip) {
    const JSZip = await loadJSZip();
    const zip   = await JSZip.loadAsync(file);
    // Find the export.xml (Apple nests under apple_health_export/)
    let xmlEntry: any = null;
    zip.forEach((path: string, entry: any) => {
      if (entry.dir) return;
      const lower = path.toLowerCase();
      if (lower.endsWith("/export.xml") || lower.endsWith("export.xml")) {
        // Prefer non-CDA
        if (!xmlEntry || !lower.includes("cda")) xmlEntry = entry;
      }
    });
    if (!xmlEntry) {
      throw new Error("Zip doesn't contain export.xml — is this an Apple Health export?");
    }
    // Stream the inner XML in chunks via internalStream. Peak memory
    // = one chunk (~64 KB default) + our aggregator (small).
    await new Promise<void>((resolve, reject) => {
      const stream = xmlEntry.internalStream("string");
      let bytes = 0;
      stream.on("data", (chunk: string) => {
        bytes += chunk.length;
        feedChunk(chunk, state);
        if (onProgress) onProgress({
          bytesProcessed: bytes,
          recordsSeen:    state.records,
          daysAccumulated: state.agg.size(),
        });
      });
      stream.on("error", (err: Error) => reject(err));
      stream.on("end", () => resolve());
      stream.resume();
    });
  } else {
    // Raw XML — stream via File.stream() + TextDecoderStream
    const reader = file.stream()
      .pipeThrough(new TextDecoderStream())
      .getReader();
    let bytes = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        bytes += value.length;
        feedChunk(value, state);
        if (onProgress) onProgress({
          bytesProcessed: bytes,
          recordsSeen:    state.records,
          daysAccumulated: state.agg.size(),
        });
      }
    }
  }

  return fillDerived(state.agg.resolve());
}
