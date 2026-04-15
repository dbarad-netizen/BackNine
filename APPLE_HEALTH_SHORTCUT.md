# BackNine — Apple Health Shortcut Setup

## What the Shortcut does
Reads today's health data from Apple HealthKit and POSTs it to BackNine.
Run it manually once a day, or automate it with a daily Time of Day trigger.

---

## Building the Shortcut in the iOS Shortcuts app

### Required actions (in order)

1. **Get Contents of Health Store** (repeat for each metric)
   Add one "Get Quantity Samples from Health Store" action per metric:

   | Health Category | Type | Aggregation | Time | Variable name |
   |---|---|---|---|---|
   | Activity | Step Count | Sum | Today | `steps` |
   | Sleep | Sleep Analysis – Asleep | Sum (hours) | Last Night | `sleep_hours` |
   | Activity | Active Energy Burned | Sum | Today | `active_calories` |
   | Heart | Resting Heart Rate | Average | Today | `resting_hr` |
   | Heart | Heart Rate Variability (SDNN) | Average | Today | `hrv` |
   | Body Measurements | Body Mass | Latest | — | `weight_lb` |
   | Activity | VO2 Max | Latest | — | `vo2_max` |
   | Vital Signs | Respiratory Rate | Average | Today | `resp_rate` |

2. **Get Current Date** → format as `YYYY-MM-DD` (use "Format Date" action with custom format `yyyy-MM-dd`) → name variable `today_date`

3. **Get Dictionary** — build the JSON body:
   ```
   Key: date             Value: today_date
   Key: steps            Value: steps
   Key: sleep_hours      Value: sleep_hours
   Key: active_calories  Value: active_calories
   Key: resting_hr       Value: resting_hr
   Key: hrv              Value: hrv
   Key: weight_lb        Value: weight_lb
   Key: vo2_max          Value: vo2_max
   Key: respiratory_rate Value: resp_rate
   ```

4. **Get Contents of URL** (HTTP request):
   - URL: `https://backnine-hu60.onrender.com/api/apple-health/sync`
   - Method: `POST`
   - Headers:
     - `Content-Type`: `application/json`
     - `X-AH-Key`: *(paste your API key from BackNine → Apple Health tab)*
   - Request Body: **JSON** → select the Dictionary variable from step 3

5. **Show Notification** (optional): "BackNine synced ✅"

---

## Automating daily sync
1. Open Shortcuts → **Automation** tab → **+** → **Time of Day**
2. Set time (e.g. 8:00 PM — after your day's activity is captured)
3. Add action: **Run Shortcut** → select "BackNine Health Sync"
4. Turn off "Ask Before Running"

---

## Troubleshooting
- **401 error**: API key is wrong — go to BackNine → Apple Health and copy again
- **500 error**: Server may be cold-starting (Render free tier). Wait 30s and try again
- **Steps = 0**: Make sure the Shortcut has permission to read Health data (Settings → Privacy → Health → Shortcuts)
- **Sleep = 0**: iOS Sleep tracking must be enabled in the Health app, or use a sleep app that writes to HealthKit

---

## API key location
BackNine dashboard → **Apple Health** tab → copy from the "Copy" button under Step 2.

## Endpoint details
```
POST https://backnine-hu60.onrender.com/api/apple-health/sync
Header: X-AH-Key: ah_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
Content-Type: application/json

{
  "date": "2026-04-15",
  "steps": 8432,
  "sleep_hours": 7.2,
  "active_calories": 512,
  "resting_hr": 58,
  "hrv": 45.3,
  "weight_lb": 181.0,
  "vo2_max": 48.2,
  "respiratory_rate": 15.0
}
```
All fields except `date` are optional — send what your device has.
