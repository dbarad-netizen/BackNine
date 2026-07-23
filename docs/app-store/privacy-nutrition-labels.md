# BackNine — Privacy "Nutrition Label" for App Store Connect

Apple asks a series of yes/no questions about the data BackNine collects. This
document is the ground truth. Answer App Store Connect exactly as below — if
we ever change a data practice, update this file FIRST, then propagate the
change through App Store Connect, the privacy policy, and (if applicable) the
in-app disclosure.

Categories map 1:1 to Apple's official taxonomy (as of iOS 17).

---

## Overall data-collection summary

**Do you or your third-party partners collect data from this app?**
Yes.

**Is any data collected linked to the user's identity?**
Yes — see "Data Linked to You" below.

**Is any data used for tracking purposes?**
No — BackNine does not use any first- or third-party SDK that tracks users
across other apps or websites for advertising or measurement. We do not
integrate Google Analytics, Facebook Pixel, AppsFlyer, Amplitude, or similar.

If we ever add a tracking SDK later, we must return to this file first,
present an ATT (App Tracking Transparency) prompt at first launch, and update
the Nutrition Label.

---

## Data Linked to You (identifiable)

### Contact Info

- **Email address** — required for account creation and password reset

Purposes: **App functionality**, **Product personalization** (Coach Al context)

### Health & Fitness

- **Health data** — HRV, RHR, sleep stages, temperature, respiratory rate, blood pressure, weight, HbA1c and other lab values, workout logs, symptom logs, mood logs
- **Fitness data** — steps, activity minutes, VO₂ max, calories

Purposes: **App functionality**, **Analytics** (in-app trend analysis, aggregate community averages), **Product personalization**

### Financial Info

- None. We do not process payments in-app for v1. If we add IAP or subscriptions later, this becomes "Purchase history" for **App functionality**.

### Location

- None. We do not collect precise or coarse location.

### Sensitive Info

- **Medical/health data** — medications, supplements, peptides, doses, timing, adherence
- **Diet & nutrition** — meal logs, macros, hydration, vice logs (alcohol, nicotine)

Purposes: **App functionality**, **Product personalization**

### Contacts

- None. We do not read the address book. Friend invites use share-link.

### User Content

- **Photos or videos** — meal photos and lab PDFs the user attaches
- **Audio data** — none
- **Customer support** — email conversations with support@backnine.health
- **Other user content** — journal entries, chat with Coach Al, group chat messages

Purposes: **App functionality**, **Product personalization**

### Browsing History

- None.

### Search History

- None.

### Identifiers

- **User ID** — internal BackNine ID (email-linked)
- **Device ID** — none collected

Purposes: **App functionality**

### Purchases

- None for v1. Update when IAP ships.

### Usage Data

- **Product interaction** — which cards/tabs users open, which insights they act on
- **Advertising data** — none
- **Other usage data** — feature usage counts, streak history

Purposes: **Analytics**, **Product personalization**

### Diagnostics

- **Crash data** — none currently (no Sentry / Crashlytics integration; add later with a Nutrition-Label update)
- **Performance data** — none
- **Other diagnostic data** — none

---

## Data NOT Linked to You

None. All data BackNine collects is linked to a user account.

---

## Data Used to Track You

None. See top-of-file note on ATT.

---

## Apple's official app-privacy field-by-field answers

Paste these into App Store Connect → App Privacy → Data Types:

| Data Type              | Collected? | Linked to User? | Tracking? | Purposes                                         |
|------------------------|------------|-----------------|-----------|--------------------------------------------------|
| Contact Info › Email   | Yes        | Yes             | No        | App Functionality, Product Personalization       |
| Health & Fitness › Health | Yes     | Yes             | No        | App Functionality, Analytics, Personalization    |
| Health & Fitness › Fitness | Yes    | Yes             | No        | App Functionality, Analytics, Personalization    |
| Sensitive Info › Health data | Yes  | Yes             | No        | App Functionality, Personalization               |
| User Content › Photos/Videos | Yes  | Yes             | No        | App Functionality                                |
| User Content › Customer Support | Yes | Yes          | No        | App Functionality                                |
| User Content › Other User Content | Yes | Yes        | No        | App Functionality, Personalization               |
| Identifiers › User ID  | Yes        | Yes             | No        | App Functionality                                |
| Usage Data › Product Interaction | Yes | Yes         | No        | Analytics, Personalization                       |

---

## LAST REVIEWED: 2026-07-23 (David + Claude, initial draft)

Update this footer every time you change the answers above. Set a calendar
reminder to re-review annually or on any new tracking SDK integration.
