# Info.plist values to set in Xcode

When you create the Xcode project, set these in the project's Info tab
(or edit Info.plist directly). Xcode generates the surrounding XML; we
just need these keys:

## HealthKit usage descriptions (REQUIRED — app will crash without these)

These strings appear in Apple's permission prompt. Be specific or Apple
review will reject.

| Key | Value |
|---|---|
| `NSHealthShareUsageDescription` | BackNine syncs your daily Apple Health metrics — steps, sleep, heart rate, weight — so they appear on your BackNine dashboard alongside Oura and your other connected sources. Data is sent only to BackNine's own servers and never shared with anyone else. |
| `NSHealthUpdateUsageDescription` | (Optional — this app only reads. Leave blank or set "Not used by this app." if Xcode complains.) |

## Background modes (REQUIRED for background delivery to work)

Set under Signing & Capabilities → Background Modes. Or in Info.plist
under `UIBackgroundModes`:

- `fetch` (Background fetch)
- `processing` (Background processing)

## Background task identifier

Under `BGTaskSchedulerPermittedIdentifiers` (Info.plist key) add:

- `com.backnine.sync.refresh`

This MUST match the constant in `BackNineHealthSyncApp.swift`. iOS
otherwise silently refuses to schedule the task and you'll wonder why
syncs never run.

## Other standard Info.plist keys

| Key | Value |
|---|---|
| `CFBundleDisplayName` | BackNine Health Sync |
| `CFBundleShortVersionString` | 1.0 |
| `CFBundleVersion` | 1 |
| `UILaunchScreen` | Empty dict (uses default white) |
| `UIRequiredDeviceCapabilities` | `[arm64, healthkit]` |

## Entitlements

In `BackNineHealthSync.entitlements`:

- `com.apple.developer.healthkit` = YES (boolean)
- `com.apple.developer.healthkit.access` = `[]` (empty array unless you
  want clinical records, which we don't)
