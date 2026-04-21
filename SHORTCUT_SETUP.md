# BackNine Health Sync — iOS Shortcut Setup

Pulls all available health data from Apple Health and sends it to BackNine.
Run it each morning — takes about 10 seconds.

Sources:
- **Oura ring** → sleep stages, HRV, resting HR
- **InBody scale** → weight, body fat %, lean mass, skeletal muscle, visceral fat
- **Withings BP monitor** → systolic, diastolic blood pressure
- **iPhone** → steps, active calories, VO2 max, SpO2, respiratory rate

---

## Before you start

1. Open BackNine in your browser → **Metrics tab (📊)**
2. Copy your API key — it starts with `ah_`
3. Make sure Oura, InBody, and Withings apps have Apple Health sync enabled

---

## Build the Shortcut

Open **Shortcuts** app → tap **+** → name it **BackNine Health Sync**

---

### SLEEP STAGES (from Oura)

**1.** Add **Find Health Samples** → Sleep Analysis → Filter: Value is **Asleep (Deep)** → Limit 100
**2.** Add **Calculate Statistics** → Input: result from #1 → Duration → Sum
**3.** Add **Set Variable** → Name: `Deep Hours` → Value: result from #2

**4.** Add **Find Health Samples** → Sleep Analysis → Filter: Value is **Asleep (REM)** → Limit 100
**5.** Add **Calculate Statistics** → Input: result from #4 → Duration → Sum
**6.** Add **Set Variable** → Name: `REM Hours` → Value: result from #5

**7.** Add **Find Health Samples** → Sleep Analysis → Filter: Value is **Asleep (Core)** → Limit 100
**8.** Add **Calculate Statistics** → Input: result from #7 → Duration → Sum
**9.** Add **Set Variable** → Name: `Core Hours` → Value: result from #8

**10.** Add **Calculate** → expression: `Deep Hours + REM Hours + Core Hours`
**11.** Add **Set Variable** → Name: `Total Hours` → Value: result from #10

---

### HEART METRICS (from Oura)

**12.** Add **Find Health Samples** → Heart Rate Variability (SDNN) → Limit 1
**13.** Add **Get Details of Health Sample** → Detail: Value
**14.** Add **Set Variable** → Name: `HRV` → Value: result from #13

**15.** Add **Find Health Samples** → Resting Heart Rate → Limit 1
**16.** Add **Get Details of Health Sample** → Detail: Value
**17.** Add **Set Variable** → Name: `RHR` → Value: result from #16

---

### ACTIVITY (from iPhone/Oura)

**18.** Add **Find Health Samples** → Step Count → Limit 100
**19.** Add **Calculate Statistics** → Input: result from #18 → Sum
**20.** Add **Set Variable** → Name: `Steps` → Value: result from #19

**21.** Add **Find Health Samples** → Active Energy Burned → Limit 100
**22.** Add **Calculate Statistics** → Input: result from #21 → Sum
**23.** Add **Set Variable** → Name: `Active Cal` → Value: result from #22

**24.** Add **Find Health Samples** → VO2 Max → Limit 1
**25.** Add **Get Details of Health Sample** → Detail: Value
**26.** Add **Set Variable** → Name: `VO2` → Value: result from #25

**27.** Add **Find Health Samples** → Respiratory Rate → Limit 1
**28.** Add **Get Details of Health Sample** → Detail: Value
**29.** Add **Set Variable** → Name: `Resp Rate` → Value: result from #28

---

### BODY COMPOSITION (from InBody scale)

**30.** Add **Find Health Samples** → Body Mass → Limit 1
**31.** Add **Get Details of Health Sample** → Detail: Value
**32.** Add **Set Variable** → Name: `Weight` → Value: result from #31

**33.** Add **Find Health Samples** → Body Fat Percentage → Limit 1
**34.** Add **Get Details of Health Sample** → Detail: Value
**35.** Add **Set Variable** → Name: `Body Fat` → Value: result from #34

**36.** Add **Find Health Samples** → Lean Body Mass → Limit 1
**37.** Add **Get Details of Health Sample** → Detail: Value
**38.** Add **Set Variable** → Name: `Lean Mass` → Value: result from #37

**39.** Add **Find Health Samples** → Skeletal Muscle Mass → Limit 1
**40.** Add **Get Details of Health Sample** → Detail: Value
**41.** Add **Set Variable** → Name: `Muscle Mass` → Value: result from #40

**42.** Add **Find Health Samples** → Visceral Fat Rating → Limit 1
**43.** Add **Get Details of Health Sample** → Detail: Value
**44.** Add **Set Variable** → Name: `Visceral Fat` → Value: result from #43

---

### BLOOD PRESSURE (from Withings)

**45.** Add **Find Health Samples** → Blood Pressure Systolic → Limit 1
**46.** Add **Get Details of Health Sample** → Detail: Value
**47.** Add **Set Variable** → Name: `Systolic` → Value: result from #46

**48.** Add **Find Health Samples** → Blood Pressure Diastolic → Limit 1
**49.** Add **Get Details of Health Sample** → Detail: Value
**50.** Add **Set Variable** → Name: `Diastolic` → Value: result from #49

---

### BLOOD OXYGEN

**51.** Add **Find Health Samples** → Blood Oxygen Saturation → Limit 1
**52.** Add **Get Details of Health Sample** → Detail: Value
**53.** Add **Set Variable** → Name: `SpO2` → Value: result from #52

---

### BUILD AND SEND

**54.** Add **Dictionary** — tap **+** for each row:

| Type | Key | Value (variable) |
|------|-----|-----------------|
| Number | `sleep_hours` | Total Hours |
| Number | `sleep_deep_hours` | Deep Hours |
| Number | `sleep_rem_hours` | REM Hours |
| Number | `sleep_core_hours` | Core Hours |
| Number | `hrv` | HRV |
| Number | `resting_hr` | RHR |
| Number | `steps` | Steps |
| Number | `active_calories` | Active Cal |
| Number | `vo2_max` | VO2 |
| Number | `respiratory_rate` | Resp Rate |
| Number | `weight_kg` | Weight |
| Number | `body_fat_percentage` | Body Fat |
| Number | `lean_body_mass_kg` | Lean Mass |
| Number | `skeletal_muscle_mass_kg` | Muscle Mass |
| Number | `visceral_fat_rating` | Visceral Fat |
| Number | `blood_pressure_systolic` | Systolic |
| Number | `blood_pressure_diastolic` | Diastolic |
| Number | `spo2` | SpO2 |

**55.** Add **Get Contents of URL**
- URL: `https://backnine-hu60.onrender.com/api/apple-health/sync`
- Tap **Show More** → Method: **POST**
- Headers → **Add new header** (twice):
  - `Content-Type` → `application/json`
  - `X-AH-Key` → *(paste your `ah_` API key)*
- Request Body: **JSON** → pick the Dictionary from #54

**56.** Add **Show Result** → Input: result from #55

---

## Set up daily automation

1. Shortcuts app → **Automation** tab → **+** → **Personal Automation**
2. **Time of Day** → **8:30 AM** → Daily
3. Action: **Run Shortcut** → **BackNine Health Sync**
4. Turn off **Ask Before Running**
5. Save

---

## Notes

- **InBody visceral fat**: requires InBody app to have Apple Health sync enabled for "Visceral Fat Rating"
- **Withings BP**: readings appear as Blood Pressure Systolic/Diastolic in Apple Health after syncing the Withings app
- **Weight unit**: InBody syncs in your Apple Health preferred unit — if set to lbs, the backend converts automatically
- **Missing values**: if a metric isn't in Apple Health, it's just skipped — the shortcut won't fail

---

## Troubleshooting

**"Invalid API key"** → Re-paste your full `ah_` key in the X-AH-Key header

**Sleep shows 0** → Oura app → Profile → Connected Apps → Apple Health → enable Sleep

**InBody data missing** → InBody app → Settings → Apple Health → enable all body composition types

**Withings BP missing** → Withings app → Settings → Health → Apple Health → enable Heart

**Health permissions** → Settings → Privacy & Security → Health → Shortcuts → allow all types
