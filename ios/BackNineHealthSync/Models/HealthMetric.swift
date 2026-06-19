// HealthMetric.swift
//
// One row per metric we read from HealthKit and send to BackNine.
// Centralizing this lets the detail view loop over the catalog and
// the sync code do one consistent thing per metric without hardcoded lists.
//
// To add a new metric: add a case here, give it the right HKQuantityType
// and aggregation rule, and the rest of the app picks it up automatically.

import Foundation
import HealthKit

enum HealthMetric: String, CaseIterable, Identifiable {
    case steps             // Sum of step count, all sources
    case activeCalories    // Sum of active energy burned (kcal)
    case restingHR         // Average resting heart rate (bpm)
    case hrv               // Average HRV SDNN (ms)
    case sleepHours        // Sum of asleep time samples (seconds, sent as hours)
    case weight            // Most-recent body mass sample (kg)
    case vo2Max            // Most-recent VO2 max sample (ml/kg/min)
    case respiratoryRate   // Average respiratory rate (br/min)
    case bodyFatPercentage // Most-recent body-fat-percentage sample (0-1, sent as %)

    var id: String { rawValue }

    /// User-facing label for the detail screen.
    var displayName: String {
        switch self {
        case .steps:             return "Steps"
        case .activeCalories:    return "Active Calories"
        case .restingHR:         return "Resting Heart Rate"
        case .hrv:               return "Heart Rate Variability"
        case .sleepHours:        return "Sleep"
        case .weight:            return "Weight"
        case .vo2Max:            return "VO₂ Max"
        case .respiratoryRate:   return "Respiratory Rate"
        case .bodyFatPercentage: return "Body Fat %"
        }
    }

    /// Single-character glyph for compact UI rows.
    var icon: String {
        switch self {
        case .steps:             return "figure.walk"
        case .activeCalories:    return "flame.fill"
        case .restingHR:         return "heart.fill"
        case .hrv:               return "waveform.path.ecg"
        case .sleepHours:        return "bed.double.fill"
        case .weight:            return "scalemass.fill"
        case .vo2Max:            return "lungs.fill"
        case .respiratoryRate:   return "wind"
        case .bodyFatPercentage: return "percent"
        }
    }

    /// The JSON key BackNine's `/api/apple-health/sync` endpoint expects.
    /// Keep these matching `apple_health.sync_day` in the Python backend.
    var apiKey: String {
        switch self {
        case .steps:             return "steps"
        case .activeCalories:    return "active_calories"
        case .restingHR:         return "resting_hr"
        case .hrv:               return "hrv"
        case .sleepHours:        return "sleep_hours"
        case .weight:            return "weight_kg"
        case .vo2Max:            return "vo2_max"
        case .respiratoryRate:   return "respiratory_rate"
        case .bodyFatPercentage: return "body_fat_percentage"
        }
    }

    /// The HealthKit sample type backing this metric.
    var quantityType: HKQuantityType? {
        switch self {
        case .steps:             return HKQuantityType.quantityType(forIdentifier: .stepCount)
        case .activeCalories:    return HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)
        case .restingHR:         return HKQuantityType.quantityType(forIdentifier: .restingHeartRate)
        case .hrv:               return HKQuantityType.quantityType(forIdentifier: .heartRateVariabilitySDNN)
        case .sleepHours:        return nil // Sleep uses HKCategoryType — handled separately
        case .weight:            return HKQuantityType.quantityType(forIdentifier: .bodyMass)
        case .vo2Max:            return HKQuantityType.quantityType(forIdentifier: .vo2Max)
        case .respiratoryRate:   return HKQuantityType.quantityType(forIdentifier: .respiratoryRate)
        case .bodyFatPercentage: return HKQuantityType.quantityType(forIdentifier: .bodyFatPercentage)
        }
    }

    /// Which aggregation makes sense over the daily window.
    enum Aggregation {
        case sum         // steps, calories
        case average     // resting HR, HRV, respiratory rate
        case mostRecent  // weight, VO2, body fat (latest sample wins)
        case sleepHours  // sleep is a HKCategoryType — special-cased
    }

    var aggregation: Aggregation {
        switch self {
        case .steps, .activeCalories:                                        return .sum
        case .restingHR, .hrv, .respiratoryRate:                             return .average
        case .weight, .vo2Max, .bodyFatPercentage:                           return .mostRecent
        case .sleepHours:                                                    return .sleepHours
        }
    }

    /// Unit we want HealthKit to give us the value in. Backend expects the
    /// unit baked into the apiKey name (e.g. weight_kg in kilograms).
    var preferredUnit: HKUnit {
        switch self {
        case .steps:             return .count()
        case .activeCalories:    return .kilocalorie()
        case .restingHR, .hrv:   return HKUnit(from: "count/min") // bpm-compatible
        case .sleepHours:        return .hour() // we'll convert seconds → hours ourselves
        case .weight:            return .gramUnit(with: .kilo)
        case .vo2Max:            return HKUnit(from: "ml/kg*min")
        case .respiratoryRate:   return HKUnit(from: "count/min")
        case .bodyFatPercentage: return .percent()
        }
    }
}
