// HealthKitManager.swift
//
// All HealthKit work in one place: authorization, daily aggregation,
// and the high-level "sync yesterday" operation. Observer queries
// (background delivery) are also wired here so HealthKit wakes us
// when relevant samples change — this is how the app stays fresh
// without the user opening it.
//
// Single shared instance — see `BackNineHealthSyncApp` for the source
// of truth; all views use `@EnvironmentObject` to read state from it.

import Foundation
import HealthKit
import Combine

@MainActor
final class HealthKitManager: ObservableObject {
    static let shared = HealthKitManager()

    private let store = HKHealthStore()

    /// One-shot flag set when we've successfully asked for permissions.
    /// True doesn't mean GRANTED — HealthKit doesn't tell us which sample
    /// types the user toggled on/off (privacy by design). It just means we
    /// shouldn't keep prompting on every launch.
    @Published private(set) var hasAskedForAuthorization: Bool = {
        UserDefaults.standard.bool(forKey: "hasAskedHealthKit")
    }()

    @Published var lastError: String?

    // MARK: - Authorization

    /// Ask HealthKit for read access to every metric in our catalog plus
    /// sleep (which is a category type, not a quantity type).
    func requestAuthorizationIfNeeded() async {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        guard !hasAskedForAuthorization else { return }

        var readTypes: Set<HKObjectType> = []
        for metric in HealthMetric.allCases {
            if let type = metric.quantityType {
                readTypes.insert(type)
            }
        }
        if let sleep = HKCategoryType.categoryType(forIdentifier: .sleepAnalysis) {
            readTypes.insert(sleep)
        }

        do {
            try await store.requestAuthorization(toShare: [], read: readTypes)
            hasAskedForAuthorization = true
            UserDefaults.standard.set(true, forKey: "hasAskedHealthKit")
            registerBackgroundDelivery(readTypes: readTypes)
        } catch {
            lastError = "HealthKit permission error: \(error.localizedDescription)"
        }
    }

    /// Tell HealthKit to wake the app when these sample types change.
    /// Background delivery frequency is `.hourly` minimum — Apple caps it.
    private func registerBackgroundDelivery(readTypes: Set<HKObjectType>) {
        for type in readTypes {
            guard let sampleType = type as? HKSampleType else { continue }
            store.enableBackgroundDelivery(for: sampleType, frequency: .hourly) { _, _ in
                // We don't need to act on the per-type callback — the
                // BGAppRefreshTask is what actually does the sync. This
                // just makes sure iOS will keep waking us at all.
            }
            // Observer query is what actually fires on changes.
            let q = HKObserverQuery(sampleType: sampleType, predicate: nil) { [weak self] _, completion, error in
                if error == nil {
                    Task { await self?.syncYesterday() }
                }
                completion()
            }
            store.execute(q)
        }
    }

    // MARK: - Sync

    /// Build yesterday's daily totals and POST them to BackNine. Designed
    /// to be safe to call repeatedly — duplicate-day syncs are a backend
    /// upsert, not a duplicate row.
    func syncYesterday() async {
        guard let key = SettingsStore.shared.apiKey else { return }

        let cal = Calendar.current
        let startOfToday = cal.startOfDay(for: Date())
        guard let startOfYesterday = cal.date(byAdding: .day, value: -1, to: startOfToday) else { return }
        let endOfYesterday = startOfToday

        let dateStr = ISO8601DateFormatter.yyyyMMdd.string(from: startOfYesterday)
        var payload: [String: Any] = ["date": dateStr]

        // Walk the catalog; gather every enabled metric in parallel.
        let settings = SettingsStore.shared
        await withTaskGroup(of: (HealthMetric, Double?).self) { group in
            for metric in HealthMetric.allCases where settings.isEnabled(metric) {
                group.addTask { @MainActor in
                    let v = await self.value(for: metric, start: startOfYesterday, end: endOfYesterday)
                    return (metric, v)
                }
            }
            for await (metric, value) in group {
                if let value = value {
                    payload[metric.apiKey] = roundedForJSON(value, metric: metric)
                    settings.recordSync(metric)
                }
            }
        }

        // No metrics actually populated → nothing to send. Avoid spamming
        // the backend with an empty payload (just `date`).
        guard payload.count > 1 else { return }

        do {
            try await BackNineAPI.sync(payload: payload, apiKey: key)
            lastError = nil
        } catch {
            lastError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    /// Round per metric so the backend gets sensible precision and we
    /// don't ship 14-digit floats for things like body fat percentage.
    private func roundedForJSON(_ value: Double, metric: HealthMetric) -> Any {
        switch metric {
        case .steps, .activeCalories, .restingHR, .respiratoryRate:
            return Int(value.rounded())
        case .hrv, .vo2Max, .weight, .sleepHours:
            return (value * 100).rounded() / 100   // 2 decimals
        case .bodyFatPercentage:
            return (value * 1000).rounded() / 10   // % with 1 decimal
        }
    }

    /// Aggregate one metric over [start, end). Returns nil if HealthKit
    /// has no samples in the window — caller drops nil-valued keys so
    /// the JSON only carries metrics the user actually generated.
    private func value(for metric: HealthMetric, start: Date, end: Date) async -> Double? {
        if metric.aggregation == .sleepHours {
            return await sleepHours(start: start, end: end)
        }
        guard let qt = metric.quantityType else { return nil }
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: [])
        let options: HKStatisticsOptions = {
            switch metric.aggregation {
            case .sum:        return [.cumulativeSum]
            case .average:    return [.discreteAverage]
            case .mostRecent: return [.discreteMostRecent]
            case .sleepHours: return []   // handled above
            }
        }()
        let stats: HKStatistics? = await withCheckedContinuation { cont in
            let q = HKStatisticsQuery(quantityType: qt, quantitySamplePredicate: predicate, options: options) { _, s, _ in
                cont.resume(returning: s)
            }
            store.execute(q)
        }
        let qty: HKQuantity?
        switch metric.aggregation {
        case .sum:        qty = stats?.sumQuantity()
        case .average:    qty = stats?.averageQuantity()
        case .mostRecent: qty = stats?.mostRecentQuantity()
        case .sleepHours: qty = nil
        }
        return qty?.doubleValue(for: metric.preferredUnit)
    }

    /// Sleep is a category type (asleep / awake / inBed states). Total the
    /// "asleep" time and convert to hours.
    private func sleepHours(start: Date, end: Date) async -> Double? {
        guard let sleep = HKCategoryType.categoryType(forIdentifier: .sleepAnalysis) else { return nil }
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: [])
        let samples: [HKCategorySample]? = await withCheckedContinuation { cont in
            let q = HKSampleQuery(sampleType: sleep, predicate: predicate, limit: HKObjectQueryNoLimit,
                                  sortDescriptors: nil) { _, samples, _ in
                cont.resume(returning: samples as? [HKCategorySample])
            }
            store.execute(q)
        }
        guard let samples = samples else { return nil }
        let asleepValues: Set<Int> = [
            HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue,
            HKCategoryValueSleepAnalysis.asleepCore.rawValue,
            HKCategoryValueSleepAnalysis.asleepDeep.rawValue,
            HKCategoryValueSleepAnalysis.asleepREM.rawValue,
        ]
        let totalSeconds = samples
            .filter { asleepValues.contains($0.value) }
            .reduce(0.0) { acc, s in acc + s.endDate.timeIntervalSince(s.startDate) }
        let hours = totalSeconds / 3600.0
        return hours > 0 ? hours : nil
    }
}

private extension ISO8601DateFormatter {
    static let yyyyMMdd: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone.current
        return f
    }()
}
