# BackNine Health Sync (iOS)

A small native iOS app whose only job is to read Apple Health data and POST
it to the BackNine backend on a schedule. Web users get all their HealthKit
metrics in BackNine without paying for Health Auto Export and without
building a manual Shortcut.

## What's in this directory

```
ios/BackNineHealthSync/
├── README.md                          ← this file
├── BackNineHealthSyncApp.swift        ← @main entry point + scene config
├── Views/
│   ├── ContentView.swift              ← Main "signed in · syncing" screen
│   ├── MetricsDetailView.swift        ← Per-metric last-sync timestamps + toggles
│   └── SignInView.swift               ← First-launch X-AH-Key paste step
├── Services/
│   ├── HealthKitManager.swift         ← HealthKit auth + sample reads + background delivery
│   ├── BackNineAPI.swift              ← POST to /api/apple-health/sync
│   └── SettingsStore.swift            ← UserDefaults wrapper for key + sync state
├── Models/
│   └── HealthMetric.swift             ← Metric enum + display metadata
├── Info.plist                         ← Permissions, background modes
└── BackNineHealthSync.entitlements    ← HealthKit + background modes
```

## How to drop this into Xcode (once David has the Apple Developer account)

1. Open Xcode → File → New → Project → iOS → App
2. Product Name: **BackNine Health Sync** · Bundle ID: **com.backnine.sync**
3. Interface: SwiftUI · Language: Swift · Include Tests: yes
4. Delete the generated `ContentView.swift` and `BackNineHealthSyncApp.swift`
5. Drag every file in this directory into the Xcode project (preserve folder
   structure with "Create groups")
6. Project → Signing & Capabilities → add **HealthKit** capability
7. Project → Signing & Capabilities → add **Background Modes** → enable
   "Background fetch" and "Background processing"
8. Build the simulator target to confirm it compiles
9. Connect a physical iPhone to test HealthKit (the simulator doesn't have
   Apple Health)

## Build dependencies

None beyond the system frameworks (`HealthKit`, `BackgroundTasks`, `SwiftUI`).
Deliberately zero third-party libraries — App Store review is faster, no
supply-chain risk, no Podfile/Package.swift to maintain.

## Configuration

`BackNineAPI.swift` points at the production backend
(`https://backnine-hu60.onrender.com`) by default. For local development,
override `BackNineAPI.baseURL` in scheme env vars.

## Architecture (one paragraph)

The app is two screens. On first launch you paste your X-AH-Key from the
BackNine web app (one-time setup). The app requests HealthKit read
permissions, registers observer queries for each metric we care about
(steps, sleep, resting HR, HRV, active calories, weight, VO2 max, body
fat, respiratory rate), and asks HealthKit to wake the app in the background
when those samples change. On wake or foreground, the app aggregates
yesterday's totals (in the user's local timezone), builds a flat JSON dict,
and POSTs to `/api/apple-health/sync` with the X-AH-Key in the header.
That's the whole app.

## Privacy

The app only **reads** HealthKit. It never writes. It only transmits to
BackNine's own backend; no third parties. The X-AH-Key is stored in iOS
Keychain (encrypted at rest, never exported). On uninstall, the Keychain
entry is purged with the app.
