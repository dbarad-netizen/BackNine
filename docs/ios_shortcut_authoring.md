# BackNine Sync Shortcut — Authoring Spec

This is the build spec for the **BackNine Sync Shortcut**, a free iPhone
shortcut that reads Apple Health data and POSTs it to the BackNine backend
once a day. It replaces the need for a paid third-party app like Health
Auto Export.

You (David) build this once on your iPhone (or Mac), share it via iCloud,
and then we plug the iCloud install link into `/connect` for one-tap user
install.

---

## Why a Shortcut

- iOS Shortcuts is built into every iPhone — no App Store install needed
- No paid third-party app required (HAE is now ~$5 one-time)
- HealthKit data is readable directly via the `Find Health Samples` action
- A daily Automation can run it without user intervention

## What it needs to do

1. Pull yesterday's daily totals for a small set of HealthKit metrics
2. Build a flat JSON object
3. POST it to `https://backnine-hu60.onrender.com/api/apple-health/sync`
   with an `X-AH-Key` header
4. (Optional) show a checkmark notification on success

## Payload spec (what the Shortcut posts)

A flat JSON object — backend already accepts this in `apple_health.sync_day`.
All fields optional. Use only what HealthKit gives you.

```json
{
  "date": "2026-06-02",
  "steps": 8523,
  "sleep_hours": 7.2,
  "sleep_deep_hours": 1.1,
  "sleep_rem_hours": 1.4,
  "sleep_core_hours": 4.5,
  "sleep_awake_hours": 0.2,
  "active_calories": 412,
  "resting_hr": 58,
  "hrv": 42,
  "weight_kg": 84.1,
  "vo2_max": 41.5,
  "respiratory_rate": 14,
  "body_fat_percentage": 18.2
}
```

- `date` — ISO `YYYY-MM-DD`, the date the data covers (yesterday by default)
- `steps`, `active_calories`, `resting_hr` — integers
- everything else — floats / decimals
- omit any field HealthKit has no value for

## HTTP details

- **Method**: POST
- **URL**: `https://backnine-hu60.onrender.com/api/apple-health/sync`
- **Headers**:
  - `Content-Type: application/json`
  - `X-AH-Key: <user's BackNine personal key>` — copied from /connect page
- **Body**: JSON above
- **Expected response**: 200 with `{ "status": "ok", "row": {...} }`

## Build instructions (iPhone Shortcuts app)

### Step 1 — Create the Shortcut

1. Open **Shortcuts** app → tap **+** in top right
2. Name it **"BackNine Sync"** (tap the title to edit)
3. Tap the ⓘ icon → toggle on **"Use Large Type for Numbers"** (off by default)

### Step 2 — Get yesterday's date

Add these actions in order:

1. **Date** action → "Current Date" → store as variable `Today`
2. **Adjust Date** action → adjust `Today` by `-1 Days` → store as `Yesterday`
3. **Format Date** action → format `Yesterday` as `Custom Format: yyyy-MM-dd` → store as `DateString`

### Step 3 — Get HealthKit data

For each metric, add a **Find Health Samples** action:

| Metric              | HealthKit Sample Type     | Operator        | Aggregation     |
|---------------------|---------------------------|-----------------|-----------------|
| Steps               | Steps                     | Sum             | Sum             |
| Active Energy       | Active Energy             | Sum             | Sum             |
| Resting HR          | Resting Heart Rate        | Average         | Average         |
| HRV                 | Heart Rate Variability    | Average         | Average         |
| Sleep (total)       | Sleep Analysis            | (see below)     | Sum of asleep   |
| Body Mass           | Body Mass                 | Most Recent     | Latest value    |
| VO2 Max             | VO2 Max                   | Most Recent     | Latest value    |

For each: set **Date Range → Specific Date → Yesterday** (the variable from
Step 2). Then immediately follow with a **Get Numbers from Health Samples**
action to extract the numeric value into a variable like `StepsVar`.

Sleep is trickiest — you'll need to filter by category "Asleep" and sum the
duration in hours. Spend the most time here; consider starting with a simple
"Sleep Analysis" sum and refining later.

### Step 4 — Build the JSON dictionary

Add a **Dictionary** action. Use the dictionary builder UI to add keys:

| Key                 | Value source                |
|---------------------|------------------------------|
| date                | `DateString` variable        |
| steps               | `StepsVar` (set type: Number)|
| active_calories     | `ActiveCalVar` (Number)      |
| resting_hr          | `RHRVar` (Number)            |
| hrv                 | `HRVVar` (Number)            |
| sleep_hours         | `SleepVar` (Number)          |
| weight_kg           | `WeightVar` (Number)         |
| vo2_max             | `VO2Var` (Number)            |

Set the type for each value to **Number**, not Text — otherwise the JSON
will come out as strings and the backend will reject them.

### Step 5 — POST to BackNine

Add a **Get Contents of URL** action:

- **URL**: `https://backnine-hu60.onrender.com/api/apple-health/sync`
- **Method**: POST
- **Request Body**: JSON → choose the Dictionary from Step 4
- **Headers** — tap "Show More" and add:
  - `Content-Type` → `application/json`
  - `X-AH-Key` → (use the **Ask Each Time** input the first time, or hardcode for personal use)

### Step 6 — Confirm success

Optional but useful for debugging:

1. **Get Dictionary Value** action → get `status` from the response
2. **If** action → if `status` is "ok":
   - **Show Notification**: "BackNine synced for ${DateString} ✓"
   - else:
   - **Show Notification**: "BackNine sync failed: ${response}"

### Step 7 — Test

Tap the play button in the Shortcut editor. Should fire the POST. Check
BackNine `/connect` → "Check sync" → should flip green.

### Step 8 — Schedule the automation

1. Shortcuts app → **Automation** tab → **+** → **Create Personal Automation**
2. Trigger: **Time of Day → 6:00 AM → Daily**
3. Actions: **Run Shortcut → BackNine Sync**
4. Toggle off **"Ask Before Running"** so it fires silently
5. Save

## Sharing for one-tap install

Once the Shortcut works:

1. Long-press the Shortcut in the My Shortcuts grid → **Share** → **iCloud Link**
2. Copy the link (looks like `https://www.icloud.com/shortcuts/<hash>`)
3. Hand it to Claude — we'll add it to `/connect/page.tsx` as the "Install
   BackNine Sync Shortcut" button

The X-AH-Key input becomes an "Ask Each Time" prompt the user fills in once
on first run; nothing else for them to configure.

## Known limitations

- iOS Shortcuts cannot read every HealthKit metric — `lean_body_mass`,
  `skeletal_muscle_mass`, and `body_fat_percentage` work on iOS 17+ but
  may need manual entry on older devices.
- The "Sleep Analysis" reading aggregates time-in-bed; getting precise
  asleep / REM / deep / core / awake stage breakdowns requires filtering
  by category which is fiddly in Shortcuts. Ship the total first, refine
  stages later.
- Workouts are accessible but only via a separate "Find Workouts" action —
  we'll do that as a v2.

## v1 metrics to include

For the first version, ship these only (skip the rest until you've
validated the pipeline):

- `date` (required)
- `steps`
- `sleep_hours` (total — skip stages for v1)
- `active_calories`
- `resting_hr`
- `hrv`
- `weight_kg`

Seven fields = a much simpler Shortcut. Add the rest in v2.
