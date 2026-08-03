"""
Apple Health XML import — parse Apple's native "Export All Health Data"
zip/xml file, aggregate by date + metric, upsert into apple_health_daily.

Why this exists (David 2026-07-30): the two prior ingest paths are
Health Auto Export (paid third-party app) and the BackNine iOS Shortcut
(manual setup). David wants neither. Apple's built-in Health app has
an "Export All Health Data" button that produces a zip containing
export.xml — this module parses that file so users can seed BackNine
with their entire HealthKit history in one upload, no third-party
tools, no shortcut, no wait for our iOS app.

Design:
  * Streaming iterparse over the XML — file sizes routinely hit
    500 MB for multi-year exports. DOM parse would OOM the server.
    iterparse clears each element after processing so peak memory
    stays flat regardless of file size.
  * Zip-aware: Apple's export is delivered as export.zip → we open it
    and stream the inner export.xml. Raw XML also accepted.
  * Aggregation strategy per metric:
      - sum-per-day        : StepCount, ActiveEnergyBurned
      - avg-per-day        : HeartRateVariabilitySDNN, RestingHeartRate,
                             RespiratoryRate, OxygenSaturation
      - most-recent-per-day: VO2Max, BodyMass, BodyFatPercentage, BP
      - sum-of-duration    : SleepAnalysis (per stage)
  * Reuses apple_health.sync_day for the write path so device_readings
    dual-write, unit conversion, and integer coercion stay consistent
    with the shortcut ingestion.

Public API:
  parse_export_xml(file_stream)      → dict[date_iso, dict[field, value]]
  import_export_file(user_id, file)  → dict summary
"""

from __future__ import annotations

import io
import logging
import zipfile
from collections import defaultdict
from datetime import datetime, timezone
from typing import IO, Dict, Iterable, Optional, Tuple
from xml.etree import ElementTree as ET


log = logging.getLogger(__name__)


# ── Metric mapping ──────────────────────────────────────────────────────
#
# HealthKit type identifier → (canonical field, aggregation strategy)
# Fields must match apple_health.FIELDS or be handled in _flatten().

_SUM     = "sum"      # add all samples in the day
_AVG     = "avg"      # mean of all samples
_LATEST  = "latest"   # most recent sample's value (by endDate)
_SLEEP   = "sleep"    # SleepAnalysis — per-stage duration sums

_TYPE_MAP: Dict[str, Tuple[str, str, Optional[str]]] = {
    # HK identifier                                → (field, agg, unit_override)
    "HKQuantityTypeIdentifierStepCount":              ("steps",                     _SUM,    None),
    "HKQuantityTypeIdentifierActiveEnergyBurned":     ("active_calories",           _SUM,    None),
    "HKQuantityTypeIdentifierRestingHeartRate":       ("resting_hr",                _AVG,    None),
    "HKQuantityTypeIdentifierHeartRateVariabilitySDNN":("hrv",                       _AVG,    None),
    "HKQuantityTypeIdentifierRespiratoryRate":        ("respiratory_rate",          _AVG,    None),
    "HKQuantityTypeIdentifierOxygenSaturation":       ("spo2",                      _AVG,    "pct"),
    "HKQuantityTypeIdentifierVO2Max":                 ("vo2_max",                   _LATEST, None),
    "HKQuantityTypeIdentifierBodyMass":               ("weight_kg",                 _LATEST, "kg"),
    "HKQuantityTypeIdentifierBodyFatPercentage":      ("body_fat_percentage",       _LATEST, "pct"),
    "HKQuantityTypeIdentifierLeanBodyMass":           ("lean_body_mass_kg",         _LATEST, "kg"),
    "HKQuantityTypeIdentifierBodyMassIndex":          ("bmi",                       _LATEST, None),
    "HKQuantityTypeIdentifierWaistCircumference":     ("waist_circumference_cm",    _LATEST, "cm"),
    "HKQuantityTypeIdentifierBloodPressureSystolic":  ("blood_pressure_systolic",   _LATEST, None),
    "HKQuantityTypeIdentifierBloodPressureDiastolic": ("blood_pressure_diastolic",  _LATEST, None),
    "HKCategoryTypeIdentifierSleepAnalysis":          ("__sleep__",                 _SLEEP,  None),
}

# Sleep stage value → field (Apple's HKCategoryValueSleepAnalysis*)
_SLEEP_STAGE_MAP: Dict[str, str] = {
    "HKCategoryValueSleepAnalysisAsleepDeep":        "sleep_deep_hours",
    "HKCategoryValueSleepAnalysisAsleepREM":         "sleep_rem_hours",
    "HKCategoryValueSleepAnalysisAsleepCore":        "sleep_core_hours",
    "HKCategoryValueSleepAnalysisAsleepUnspecified": "sleep_core_hours",
    "HKCategoryValueSleepAnalysisInBed":             "sleep_hours",   # total time-in-bed fallback
    "HKCategoryValueSleepAnalysisAwake":             "sleep_awake_hours",
}


# ── Streaming zip → xml stream helper ────────────────────────────────────

def _open_xml_stream(file: IO[bytes]) -> IO[bytes]:
    """Return a readable byte stream for the XML content. Accepts either
    a raw XML file OR Apple's export.zip (uses the inner export.xml).

    The caller is responsible for closing the returned stream if it's
    different from the input (zip case); we keep a reference on the
    stream via `.zip_owner` so callers can close both."""
    # Sniff the first two bytes — zip files start with 'PK'.
    head = file.read(2)
    file.seek(0)
    if head == b"PK":
        zf = zipfile.ZipFile(file)
        # Apple's export.zip nests everything under apple_health_export/
        # Find any *export.xml (not export_cda.xml which is the CDA format).
        candidates = [
            n for n in zf.namelist()
            if n.endswith("/export.xml") or n.endswith("export.xml")
        ]
        # Prefer non-CDA
        candidates = [n for n in candidates if "cda" not in n.lower()] or candidates
        if not candidates:
            raise ValueError(
                "Zip file doesn't contain export.xml — is this really an "
                "Apple Health export? Try re-exporting from the Health app."
            )
        inner = zf.open(candidates[0])
        inner.zip_owner = zf   # type: ignore[attr-defined]
        return inner
    return file


# ── Time parsing ─────────────────────────────────────────────────────────

def _parse_date_local(value: Optional[str]) -> Optional[str]:
    """Apple exports dates like '2026-07-15 08:34:11 -0700'. We keep the
    date component in whatever local offset was captured — the user
    experienced that day in local time, so day boundaries follow local.
    Return ISO 'YYYY-MM-DD' or None."""
    if not value:
        return None
    # Split off the space-delimited pieces; date is first
    try:
        parts = value.strip().split(" ")
        return parts[0]  # already YYYY-MM-DD
    except Exception:
        return None


def _parse_dt(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        # ' -0700' offset format
        return datetime.strptime(value.strip(), "%Y-%m-%d %H:%M:%S %z")
    except Exception:
        return None


# ── Aggregation state ────────────────────────────────────────────────────

class _Aggregator:
    """Per (date, field) bucket. Handles sum, avg, latest, and sleep-
    stage aggregations without holding raw samples in memory."""

    def __init__(self) -> None:
        # {date: {field: {"sum": float, "n": int, "latest_ts": dt, "latest_val": float}}}
        self.buckets: Dict[str, Dict[str, Dict]] = defaultdict(lambda: defaultdict(dict))

    def add_sum(self, date: str, field: str, value: float) -> None:
        b = self.buckets[date][field]
        b["sum"] = b.get("sum", 0.0) + value

    def add_avg(self, date: str, field: str, value: float) -> None:
        b = self.buckets[date][field]
        b["sum"] = b.get("sum", 0.0) + value
        b["n"]   = b.get("n", 0) + 1

    def add_latest(self, date: str, field: str, value: float, ts: datetime) -> None:
        b = self.buckets[date][field]
        prior = b.get("latest_ts")
        if prior is None or ts > prior:
            b["latest_val"] = value
            b["latest_ts"]  = ts

    def add_duration(self, date: str, field: str, seconds: float) -> None:
        """Sleep-stage duration in seconds, converted to hours on read."""
        b = self.buckets[date][field]
        b["sum"] = b.get("sum", 0.0) + seconds

    def resolve(self) -> Dict[str, Dict[str, float]]:
        """Return {date: {field: aggregated_value}}."""
        out: Dict[str, Dict[str, float]] = {}
        for date, fields in self.buckets.items():
            row: Dict[str, float] = {}
            for field, b in fields.items():
                if "latest_val" in b:
                    row[field] = b["latest_val"]
                elif "n" in b:
                    row[field] = b["sum"] / b["n"] if b["n"] else 0.0
                elif "sum" in b:
                    # sleep-stage sums are in seconds → convert to hours
                    if field.startswith("sleep_") and field.endswith("_hours"):
                        row[field] = round(b["sum"] / 3600.0, 2)
                    else:
                        row[field] = b["sum"]
            if row:
                out[date] = row
        return out


# ── Parser ──────────────────────────────────────────────────────────────

def parse_export_xml(file: IO[bytes]) -> Dict[str, Dict[str, float]]:
    """Parse Apple Health export.xml (or export.zip) and return
    per-day aggregated metrics keyed by date."""
    stream = _open_xml_stream(file)
    agg = _Aggregator()

    # iterparse yields (event, element) — we want 'end' so each Record
    # is fully populated before we touch it, then clear it to free RAM.
    context = ET.iterparse(stream, events=("end",))
    for event, elem in context:
        tag = elem.tag
        if tag == "Record":
            _process_record(elem, agg)
            elem.clear()
        elif tag == "Workout":
            # Workouts have their own container. We could sum
            # HKWorkoutActivityType durations into a "workout_min"
            # field later; not part of Phase 1.
            elem.clear()
        elif tag in ("HealthData", "Me", "Correlation"):
            # Root-level containers — skip but don't clear yet
            pass

    return agg.resolve()


def _process_record(elem: ET.Element, agg: _Aggregator) -> None:
    hk_type = elem.get("type")
    if not hk_type or hk_type not in _TYPE_MAP:
        return
    field, strategy, _unit_override = _TYPE_MAP[hk_type]

    end   = _parse_dt(elem.get("endDate") or elem.get("startDate"))
    date  = _parse_date_local(elem.get("endDate") or elem.get("startDate"))
    if not date:
        return

    if strategy == _SLEEP:
        # SleepAnalysis rows encode the stage in `value`, and the
        # session duration is endDate - startDate. We bucket duration
        # into a stage-specific field. Anchor to the END date so a
        # bedtime-crossing-midnight session lands on the wake day (matches
        # how Oura assigns nights).
        start = _parse_dt(elem.get("startDate"))
        stage_val = (elem.get("value") or "").strip()
        stage_field = _SLEEP_STAGE_MAP.get(stage_val)
        if not (stage_field and start and end):
            return
        seconds = (end - start).total_seconds()
        if seconds <= 0:
            return
        agg.add_duration(date, stage_field, seconds)
        return

    raw_val = elem.get("value")
    if raw_val is None:
        return
    try:
        val = float(raw_val)
    except (TypeError, ValueError):
        return

    if strategy == _SUM:
        agg.add_sum(date, field, val)
    elif strategy == _AVG:
        agg.add_avg(date, field, val)
    elif strategy == _LATEST and end is not None:
        agg.add_latest(date, field, val, end)


# ── Post-process: derive sleep_hours from stages if missing ──────────────

def _fill_derived(daily: Dict[str, Dict[str, float]]) -> Dict[str, Dict[str, float]]:
    """If a day has stage breakdowns but no 'sleep_hours' total, sum the
    asleep stages (deep + rem + core) to produce a canonical total.
    Apple sometimes only writes stages, not the InBed anchor."""
    for date, row in daily.items():
        if row.get("sleep_hours"):
            continue
        stages = (row.get("sleep_deep_hours") or 0) + \
                 (row.get("sleep_rem_hours")  or 0) + \
                 (row.get("sleep_core_hours") or 0)
        if stages > 0:
            row["sleep_hours"] = round(stages, 2)
    return daily


# ── Public importer ─────────────────────────────────────────────────────

def import_export_file(user_id: str, file: IO[bytes], since_date: Optional[str] = None) -> dict:
    """Parse a full Apple Health export and upsert every day it contains
    into apple_health_daily via apple_health.sync_day.

    since_date: optional 'YYYY-MM-DD' floor. Days before this are still
    parsed (single-pass is cheaper than seek-and-skip) but not written.
    Useful for incremental re-imports.

    Returns a summary dict:
      {
        days_imported: int,
        earliest_date: str | None,
        latest_date:   str | None,
        metrics_seen:  list[str],
        skipped_days:  int,
      }
    """
    if not user_id:
        raise ValueError("user_id required")

    daily = parse_export_xml(file)
    daily = _fill_derived(daily)

    if not daily:
        return {
            "days_imported": 0, "earliest_date": None, "latest_date": None,
            "metrics_seen": [], "skipped_days": 0,
        }

    import apple_health as ah   # avoid circular import at module load
    dates = sorted(daily.keys())
    written = 0
    skipped = 0
    metrics_seen: set = set()

    for date_iso in dates:
        if since_date and date_iso < since_date:
            skipped += 1
            continue
        row = daily[date_iso]
        payload = {"date": date_iso, **row}
        metrics_seen.update(row.keys())
        try:
            ah.sync_day(user_id, payload)
            written += 1
        except Exception:
            log.exception("apple_health_xml: sync_day failed for %s %s", user_id, date_iso)
            skipped += 1

    return {
        "days_imported": written,
        "earliest_date": dates[0] if dates else None,
        "latest_date":   dates[-1] if dates else None,
        "metrics_seen":  sorted(metrics_seen),
        "skipped_days":  skipped,
    }
