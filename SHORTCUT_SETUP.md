# BackNine iOS Shortcut Setup

This shortcut reads last night's sleep data from Apple Health and sends it to BackNine.
Run it each morning after your Oura app syncs — it takes about 5 seconds and gives BackNine
your full sleep detail (hours, deep, REM, HRV, RHR) immediately, without waiting for Oura's API.

---

## Step 1 — Get your API key

1. Open BackNine in your browser
2. Go to the **Metrics** tab (📊)
3. Copy the API key shown — it starts with `ah_`

---

## Step 2 — Build the Shortcut

Open the **Shortcuts** app on your iPhone and tap **+** to create a new shortcut.
Name it **BackNine Sleep Sync**.

Add these actions in order:

---

### Action 1: Set Variable — API Key
- Action: **Set Variable**
- Variable name: `API Key`
- Value: *(paste your `ah_` key here)*

---

### Action 2: Set Variable — Endpoint
- Action: **Set Variable**
- Variable name: `Endpoint`
- Value: `https://backnine-hu60.onrender.com/api/apple-health/sync`

---

### Action 3: Get today's date string
- Action: **Format Date**
- Date: **Current Date**
- Format: **Custom** → `yyyy-MM-dd`
- Store result in variable: `Today`

---

### Action 4: Get Deep Sleep
- Action: **Find Health Samples**
- Type: **Sleep Analysis**
- Filter: **Value** is **Asleep (Deep)**
- Sort by: **Start Date**, Descending
- Limit: **100**
- Store in variable: `Deep Samples`

### Action 5: Calculate Deep Hours
- Action: **Calculate Statistics**  
- Input: `Deep Samples` → **Duration** (in hours)  
  *(tap the variable, then choose Duration)*
- Statistic: **Sum**
- Store in variable: `Deep Hours`

---

### Action 6: Get REM Sleep
- Action: **Find Health Samples**
- Type: **Sleep Analysis**
- Filter: **Value** is **Asleep (REM)**
- Sort by: **Start Date**, Descending
- Limit: **100**
- Store in variable: `REM Samples`

### Action 7: Calculate REM Hours
- Action: **Calculate Statistics**
- Input: `REM Samples` → **Duration** (hours)
- Statistic: **Sum**
- Store in variable: `REM Hours`

---

### Action 8: Get Core Sleep
- Action: **Find Health Samples**
- Type: **Sleep Analysis**
- Filter: **Value** is **Asleep (Core)**
- Sort by: **Start Date**, Descending
- Limit: **100**
- Store in variable: `Core Samples`

### Action 9: Calculate Core Hours
- Action: **Calculate Statistics**
- Input: `Core Samples` → **Duration** (hours)
- Statistic: **Sum**
- Store in variable: `Core Hours`

---

### Action 10: Calculate Total Sleep Hours
- Action: **Calculate**
- Expression: `Deep Hours + REM Hours + Core Hours`
- Store in variable: `Total Hours`

---

### Action 11: Get HRV
- Action: **Find Health Samples**
- Type: **Heart Rate Variability (SDNN)**
- Sort by: **Start Date**, Descending
- Limit: **1**
- Store in variable: `HRV Sample`

### Action 12: Get HRV Value
- Action: **Get Details of Health Sample**
- Input: `HRV Sample`
- Detail: **Value**
- Store in variable: `HRV`

---

### Action 13: Get Resting Heart Rate
- Action: **Find Health Samples**
- Type: **Resting Heart Rate**
- Sort by: **Start Date**, Descending
- Limit: **1**
- Store in variable: `RHR Sample`

### Action 14: Get RHR Value
- Action: **Get Details of Health Sample**
- Input: `RHR Sample`
- Detail: **Value**
- Store in variable: `RHR`

---

### Action 15: Build the payload
- Action: **Dictionary**
- Add these key/value pairs:
  | Key | Type | Value |
  |-----|------|-------|
  | `date` | Text | `Today` (variable) |
  | `sleep_hours` | Number | `Total Hours` (variable) |
  | `sleep_deep_hours` | Number | `Deep Hours` (variable) |
  | `sleep_rem_hours` | Number | `REM Hours` (variable) |
  | `sleep_core_hours` | Number | `Core Hours` (variable) |
  | `hrv` | Number | `HRV` (variable) |
  | `resting_hr` | Number | `RHR` (variable) |

- Store in variable: `Payload`

---

### Action 16: POST to BackNine
- Action: **Get Contents of URL**
- URL: `Endpoint` (variable)
- Method: **POST**
- Headers:
  | Key | Value |
  |-----|-------|
  | `Content-Type` | `application/json` |
  | `X-AH-Key` | `API Key` (variable) |
- Request Body: **JSON** → `Payload` (variable)

---

### Action 17: Show result (optional)
- Action: **Show Result**
- Input: `Contents of URL`
  *(shows the server response so you can confirm it worked)*

---

## Step 3 — Set up Automation (runs automatically every morning)

1. In the Shortcuts app, tap **Automation** (bottom tab)
2. Tap **+** → **Personal Automation**
3. Choose **Time of Day**
4. Set time to **8:30 AM**, repeat **Daily**
5. Add action: **Run Shortcut** → **BackNine Sleep Sync**
6. Turn off **Ask Before Running**
7. Save

This way, every morning at 8:30am, BackNine automatically gets your full sleep data from
Apple Health — no manual action needed.

---

## How it works

```
Oura ring  ──►  Oura app (syncs in ~5 min)  ──►  Apple Health
                                                        │
                                        BackNine Shortcut reads from AH
                                                        │
                                        POST to /api/apple-health/sync
                                                        │
                                        BackNine shows full sleep detail
                                        (hours, deep, REM, HRV, RHR)
```

Instead of waiting 2-4 hours for Oura's API to process your session,
BackNine reads directly from Apple Health, which Oura populates within
minutes of the app syncing.

---

## Troubleshooting

**"Invalid API key"** → Check that you copied the full `ah_` key from the Metrics tab

**Sleep shows 0 hours** → Make sure Oura is set to write to Apple Health:
Oura app → Profile → Connected Apps → Apple Health → enable Sleep

**HRV/RHR missing** → Oura may not write these to Apple Health. The shortcut
will still send sleep hours and stages — HRV and RHR will come from Oura's API
once it catches up.
