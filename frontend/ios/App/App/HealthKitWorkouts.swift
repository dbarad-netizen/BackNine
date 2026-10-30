//
//  HealthKitWorkouts.swift
//  BackNine
//
//  2026-10-30 — one HKWorkout → one event row, shared by the foreground
//  plugin (queryWorkouts) and BackgroundHealthSync so the two paths can
//  never drift. Row shape mirrors Oura's /workout import in
//  backend/training.py: id, activity, startDate, endDate, durationMin,
//  calories, distanceMeters, avgHr, sourceName.
//

import Foundation
import HealthKit

enum HealthKitWorkouts {

    static func activityName(_ t: HKWorkoutActivityType) -> String {
        switch t {
        case .walking:                     return "walking"
        case .running:                     return "running"
        case .cycling:                     return "cycling"
        case .hiking:                      return "hiking"
        case .swimming:                    return "swimming"
        case .traditionalStrengthTraining: return "strength_training"
        case .functionalStrengthTraining:  return "strength_training"
        case .yoga:                        return "yoga"
        case .pilates:                     return "pilates"
        case .golf:                        return "golf"
        case .tennis:                      return "tennis"
        case .elliptical:                  return "elliptical"
        case .rowing:                      return "rowing"
        case .stairClimbing:               return "stair_climbing"
        case .highIntensityIntervalTraining: return "hiit"
        case .coreTraining:                return "core_training"
        case .flexibility:                 return "stretching"
        case .mindAndBody:                 return "mind_and_body"
        case .crossTraining:               return "cross_training"
        case .mixedCardio:                 return "cardio"
        case .cooldown:                    return "cooldown"
        case .dance, .socialDance:         return "dance"
        case .basketball:                  return "basketball"
        case .soccer:                      return "soccer"
        case .pickleball:                  return "pickleball"
        default:                           return "workout"
        }
    }

    /// Fetch workouts in [start, end]; completion on the HealthKit queue.
    static func fetch(store: HKHealthStore, start: Date, end: Date,
                      completion: @escaping ([[String: Any]], Error?) -> Void) {
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: [])
        let sort = [NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)]
        let out = ISO8601DateFormatter()
        out.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let query = HKSampleQuery(sampleType: HKObjectType.workoutType(), predicate: predicate,
                                  limit: 500, sortDescriptors: sort) { _, samples, error in
            if let error = error { completion([], error); return }
            var rows: [[String: Any]] = []
            for case let w as HKWorkout in (samples ?? []) {
                var row: [String: Any] = [
                    "id":          w.uuid.uuidString,
                    "activity":    activityName(w.workoutActivityType),
                    "startDate":   out.string(from: w.startDate),
                    "endDate":     out.string(from: w.endDate),
                    "durationMin": Int(w.duration / 60.0),
                    "sourceName":  w.sourceRevision.source.name,
                ]
                if let kcal = w.totalEnergyBurned?.doubleValue(for: .kilocalorie()) {
                    row["calories"] = Int(kcal.rounded())
                }
                if let m = w.totalDistance?.doubleValue(for: .meter()) {
                    row["distanceMeters"] = Int(m.rounded())
                }
                // Average HR is in the workout statistics on iOS 16+.
                if #available(iOS 16.0, *),
                   let hrType = HKQuantityType.quantityType(forIdentifier: .heartRate),
                   let avg = w.statistics(for: hrType)?.averageQuantity() {
                    row["avgHr"] = Int(avg.doubleValue(for: HKUnit.count().unitDivided(by: .minute())).rounded())
                }
                rows.append(row)
            }
            completion(rows, nil)
        }
        store.execute(query)
    }
}
