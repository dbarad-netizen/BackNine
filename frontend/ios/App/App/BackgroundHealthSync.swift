//
//  BackgroundHealthSync.swift
//  BackNine
//
//  David 2026-10-14: "can you build the healthkit stuff so we have real
//  time access to the data?"
//
//  Before this, Apple Health data only reached BackNine when the user
//  opened the app (healthkit.ts → syncRecent). Chris's data "ran through
//  Friday" on a Sunday text because he hadn't opened the app since
//  Friday. HealthKit background delivery fixes that: iOS wakes the app
//  in the background when new samples land (hourly at best for most
//  types — Apple's cap, not ours), we aggregate the last few days
//  natively and POST to the same endpoint the JS sync uses.
//
//  Aggregation mirrors healthkit.ts EXACTLY so a foreground sync and a
//  background sync can never disagree about a day:
//    steps / active_calories : per-source totals, MAX across sources
//    resting_hr / hrv / respiratory_rate / spo2 : mean of samples
//    sleep_hours / sleep_deep_hours / sleep_rem_hours : per-source
//      interval UNION (overlapping spans count once), MAX across sources
//    day key: first 10 chars of the ISO-8601 (UTC) end date — same as
//      dateKeyLocal() in healthkit.ts. Keep in lockstep if that changes.
//  Slow-cadence metrics (weight, body fat, BP, VO2) are left to the
//  foreground sync; they don't need background delivery.
//
//  Credentials: the JS side hands us the session token + API base via
//  the plugin (configureBackgroundSync). Token lives in the Keychain.
//
//  Xcode: Signing & Capabilities → HealthKit → tick "Background
//  Delivery" (adds com.apple.developer.healthkit.background-delivery to
//  App.entitlements — already present in the repo copy).
//

import Foundation
import HealthKit
import Security

final class BackgroundHealthSync {

    static let shared = BackgroundHealthSync()

    private let store = HKHealthStore()
    private var observers: [HKObserverQuery] = []
    private var started = false
    private let syncQueue = DispatchQueue(label: "health.backnine.bgsync")
    private var lastSyncAt: Date = .distantPast

    // ── Config (token in Keychain, base URL in UserDefaults) ────────

    private let keychainAccount = "bn_session_token"
    private let baseURLKey      = "bn_api_base"
    private let lastSyncKey     = "bn_bg_last_sync"

    func configure(token: String, baseURL: String) {
        Keychain.set(token, account: keychainAccount)
        UserDefaults.standard.set(baseURL, forKey: baseURLKey)
        startIfConfigured()
    }

    func clear() {
        Keychain.delete(account: keychainAccount)
        UserDefaults.standard.removeObject(forKey: baseURLKey)
        stop()
    }

    var isConfigured: Bool {
        return Keychain.get(account: keychainAccount) != nil
            && UserDefaults.standard.string(forKey: baseURLKey) != nil
    }

    var lastBackgroundSync: Date? {
        return UserDefaults.standard.object(forKey: lastSyncKey) as? Date
    }

    // ── Types we watch ──────────────────────────────────────────────

    private struct Metric {
        let type: HKSampleType
        let field: String
        let unit: HKUnit?
        let strategy: String   // "sum" | "avg" | "sleep"
    }

    private var metrics: [Metric] {
        var out: [Metric] = []
        func q(_ id: HKQuantityTypeIdentifier, _ field: String, _ unit: HKUnit, _ s: String) {
            if let t = HKQuantityType.quantityType(forIdentifier: id) {
                out.append(Metric(type: t, field: field, unit: unit, strategy: s))
            }
        }
        q(.stepCount,                  "steps",            .count(),                                    "sum")
        q(.activeEnergyBurned,         "active_calories",  .kilocalorie(),                              "sum")
        q(.restingHeartRate,           "resting_hr",       HKUnit.count().unitDivided(by: .minute()),   "avg")
        q(.heartRateVariabilitySDNN,   "hrv",              .secondUnit(with: .milli),                   "avg")
        q(.respiratoryRate,            "respiratory_rate", HKUnit.count().unitDivided(by: .minute()),   "avg")
        q(.oxygenSaturation,           "spo2",             .percent(),                                  "avg")
        if let sleep = HKCategoryType.categoryType(forIdentifier: .sleepAnalysis) {
            out.append(Metric(type: sleep, field: "sleep_hours", unit: nil, strategy: "sleep"))
        }
        // Workouts (2026-10-30): observed so a finished Watch walk wakes a
        // sync; not aggregated into daily — posted as events after it.
        out.append(Metric(type: HKObjectType.workoutType(), field: "workouts", unit: nil, strategy: "workouts"))
        return out
    }

    // ── Observers + background delivery ────────────────────────────

    /// Call from AppDelegate.didFinishLaunching. Idempotent. Safe to
    /// call before HealthKit authorization — observers simply get no
    /// updates until the user grants access in the app.
    func startIfConfigured() {
        guard HKHealthStore.isHealthDataAvailable(), isConfigured, !started else { return }
        started = true
        for m in metrics {
            let query = HKObserverQuery(sampleType: m.type, predicate: nil) { [weak self] _, completion, error in
                guard let self = self else { completion(); return }
                if let error = error {
                    NSLog("BACKNINE bgsync: observer error for \(m.field): \(error.localizedDescription)")
                    completion()
                    return
                }
                // Several types often change at once (a workout writes
                // steps, energy, HR). Coalesce: one sync per 2 minutes.
                self.syncQueue.async {
                    if Date().timeIntervalSince(self.lastSyncAt) < 120 {
                        completion()
                        return
                    }
                    self.lastSyncAt = Date()
                    self.syncRecent(days: 7) { _ in completion() }   // 7 not 3: late-flushing watch (2026-10-30)
                }
            }
            store.execute(query)
            observers.append(query)
            store.enableBackgroundDelivery(for: m.type, frequency: .hourly) { ok, err in
                if let err = err {
                    NSLog("BACKNINE bgsync: enableBackgroundDelivery(\(m.field)) failed: \(err.localizedDescription)")
                } else {
                    NSLog("BACKNINE bgsync: background delivery \(ok ? "on" : "OFF") for \(m.field)")
                }
            }
        }
    }

    func stop() {
        for q in observers { store.stop(q) }
        observers.removeAll()
        started = false
        store.disableAllBackgroundDelivery { _, _ in }
    }

    // ── The sync itself ─────────────────────────────────────────────

    /// Query the last `days` days, aggregate like healthkit.ts, POST.
    /// Completion receives the number of days posted (0 on failure).
    func syncRecent(days: Int, completion: @escaping (Int) -> Void) {
        guard let token = Keychain.get(account: keychainAccount),
              let base  = UserDefaults.standard.string(forKey: baseURLKey) else {
            completion(0); return
        }
        let now   = Date()
        let start = now.addingTimeInterval(-Double(days) * 86400)
        let predicate = HKQuery.predicateForSamples(withStart: start, end: now, options: [])
        let sort = [NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: true)]

        // date -> field -> aggregator state
        var sum:       [String: [String: [String: Double]]] = [:]          // date/field/source -> total
        var avg:       [String: [String: (Double, Int)]] = [:]             // date/field -> (sum, n)
        var intervals: [String: [String: [String: [(Double, Double)]]]] = [:] // date/field/source -> [(s,e)]
        var bedtime:   [String: Double] = [:]                                   // date -> earliest asleep start (ms)

        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        func dayKey(_ d: Date) -> String { return String(iso.string(from: d).prefix(10)) }

        let group = DispatchGroup()
        for m in metrics where m.strategy != "workouts" {   // workouts are posted separately
            group.enter()
            let q = HKSampleQuery(sampleType: m.type, predicate: predicate,
                                  limit: HKObjectQueryNoLimit, sortDescriptors: sort) { _, samples, error in
                defer { group.leave() }
                guard error == nil, let samples = samples else { return }
                for s in samples {
                    let date = dayKey(s.endDate)
                    let source = s.sourceRevision.source.name
                    if m.strategy == "sleep", let c = s as? HKCategorySample {
                        let v = c.value
                        let asleepUnspecified = HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue
                        let isAsleep = (v == asleepUnspecified || v == 3 || v == 4 || v == 5)
                        guard isAsleep else { continue }
                        let s0 = c.startDate.timeIntervalSince1970 * 1000
                        let e0 = c.endDate.timeIntervalSince1970 * 1000
                        guard e0 > s0 else { continue }
                        self.syncQueue.sync {
                            if bedtime[date] == nil || s0 < bedtime[date]! { bedtime[date] = s0 }
                            intervals[date, default: [:]]["sleep_hours", default: [:]][source, default: []].append((s0, e0))
                            if v == 4 { intervals[date, default: [:]]["sleep_deep_hours", default: [:]][source, default: []].append((s0, e0)) }
                            if v == 5 { intervals[date, default: [:]]["sleep_rem_hours",  default: [:]][source, default: []].append((s0, e0)) }
                        }
                    } else if let qs = s as? HKQuantitySample, let unit = m.unit {
                        var val = qs.quantity.doubleValue(for: unit)
                        if m.field == "spo2" && val <= 1 { val *= 100 }
                        self.syncQueue.sync {
                            if m.strategy == "sum" {
                                sum[date, default: [:]][m.field, default: [:]][source, default: 0] += val
                            } else {
                                let cur = avg[date, default: [:]][m.field] ?? (0, 0)
                                avg[date, default: [:]][m.field] = (cur.0 + val, cur.1 + 1)
                            }
                        }
                    }
                }
            }
            store.execute(q)
        }

        group.notify(queue: syncQueue) {
            // Resolve — same rules as Aggregator.resolve() in healthkit.ts
            var daily: [String: [String: Any]] = [:]
            for (date, fields) in sum {
                for (field, perSource) in fields {
                    let best = perSource.values.max() ?? 0
                    daily[date, default: [:]][field] = best.rounded()
                }
            }
            for (date, fields) in avg {
                for (field, acc) in fields where acc.1 > 0 {
                    daily[date, default: [:]][field] = acc.0 / Double(acc.1)
                }
            }
            for (date, fields) in intervals {
                for (field, perSource) in fields {
                    var best = 0.0
                    for (_, ivsRaw) in perSource {
                        let ivs = ivsRaw.sorted { $0.0 < $1.0 }
                        guard var curS = ivs.first?.0, var curE = ivs.first?.1 else { continue }
                        var total = 0.0
                        if ivs.count > 1 {
                            for i in 1..<ivs.count {
                                let (s0, e0) = ivs[i]
                                if s0 <= curE { if e0 > curE { curE = e0 } }
                                else { total += curE - curS; curS = s0; curE = e0 }
                            }
                        }
                        total += curE - curS
                        if total > best { best = total }
                    }
                    daily[date, default: [:]][field] = (best / 3_600_000.0 * 100).rounded() / 100
                }
            }
            // Bedtime as ISO string for the sleep-timing band (mirrors healthkit.ts).
            let isoOut = ISO8601DateFormatter()
            isoOut.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            for (date, ms) in bedtime where daily[date]?["sleep_hours"] != nil {
                daily[date, default: [:]]["sleep_start"] = isoOut.string(from: Date(timeIntervalSince1970: ms / 1000))
            }
            let finish: (Int) -> Void = { n in
                // Workouts ride along after the daily post (mirrors healthkit.ts).
                self.postWorkouts(days: days, token: token, base: base) { completion(n) }
            }
            guard !daily.isEmpty else { finish(0); return }
            self.post(daily: daily, token: token, base: base, completion: finish)
        }
    }

    private func postWorkouts(days: Int, token: String, base: String, completion: @escaping () -> Void) {
        let now = Date()
        let start = now.addingTimeInterval(-Double(days) * 86400)
        HealthKitWorkouts.fetch(store: store, start: start, end: now) { rows, error in
            if let error = error {
                NSLog("BACKNINE bgsync: workout query failed: \(error.localizedDescription)")
                completion(); return
            }
            guard !rows.isEmpty,
                  let url = URL(string: base.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
                                      + "/api/apple-health/workouts") else { completion(); return }
            var req = URLRequest(url: url)
            req.httpMethod = "POST"
            req.timeoutInterval = 25
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            req.setValue("backnine-ios-bgsync", forHTTPHeaderField: "X-BackNine-Sync-Source")
            do {
                req.httpBody = try JSONSerialization.data(withJSONObject: ["workouts": rows], options: [])
            } catch { completion(); return }
            URLSession.shared.dataTask(with: req) { _, resp, err in
                if let err = err {
                    NSLog("BACKNINE bgsync: workouts POST failed: \(err.localizedDescription)")
                } else {
                    NSLog("BACKNINE bgsync: posted \(rows.count) workout(s), status \((resp as? HTTPURLResponse)?.statusCode ?? 0)")
                }
                completion()
            }.resume()
        }
    }

    private func post(daily: [String: [String: Any]], token: String, base: String,
                      completion: @escaping (Int) -> Void) {
        guard let url = URL(string: base.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
                                  + "/api/apple-health/import-aggregated") else { completion(0); return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 25
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let df = DateFormatter(); df.dateFormat = "yyyy-MM-dd"; df.timeZone = TimeZone.current
        req.setValue(df.string(from: Date()), forHTTPHeaderField: "X-User-Local-Date")
        req.setValue("backnine-ios-bgsync", forHTTPHeaderField: "X-BackNine-Sync-Source")
        do {
            req.httpBody = try JSONSerialization.data(withJSONObject: ["daily": daily], options: [])
        } catch { completion(0); return }
        let task = URLSession.shared.dataTask(with: req) { data, resp, err in
            if let err = err {
                NSLog("BACKNINE bgsync: POST failed: \(err.localizedDescription)")
                completion(0); return
            }
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            if code == 401 {
                // Session expired — stop hammering; the next foreground
                // open re-configures us with a fresh token.
                NSLog("BACKNINE bgsync: 401 — token expired, pausing background sync")
                Keychain.delete(account: self.keychainAccount)
                completion(0); return
            }
            guard (200..<300).contains(code) else {
                NSLog("BACKNINE bgsync: POST status \(code)")
                completion(0); return
            }
            UserDefaults.standard.set(Date(), forKey: self.lastSyncKey)
            var n = daily.count
            if let d = data, let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
               let imported = j["days_imported"] as? Int { n = imported }
            NSLog("BACKNINE bgsync: posted \(n) day(s)")
            completion(n)
        }
        task.resume()
    }
}

// ── Minimal Keychain helper ─────────────────────────────────────────

enum Keychain {
    private static let service = "health.backnine.app"

    static func set(_ value: String, account: String) {
        let data = Data(value.utf8)
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                    kSecAttrService as String: service,
                                    kSecAttrAccount as String: account]
        SecItemDelete(query as CFDictionary)
        var add = query
        add[kSecValueData as String] = data
        // Accessible after first unlock so background syncs work while the
        // phone is locked (but not before the first unlock after reboot).
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(add as CFDictionary, nil)
    }

    static func get(account: String) -> String? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                    kSecAttrService as String: service,
                                    kSecAttrAccount as String: account,
                                    kSecReturnData as String: true,
                                    kSecMatchLimit as String: kSecMatchLimitOne]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func delete(account: String) {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                    kSecAttrService as String: service,
                                    kSecAttrAccount as String: account]
        SecItemDelete(query as CFDictionary)
    }
}
