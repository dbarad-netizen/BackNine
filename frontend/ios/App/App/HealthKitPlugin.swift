//
//  HealthKitPlugin.swift
//  BackNine
//
//  David 2026-08-06: hand-rolled Capacitor plugin because
//  @perfood/capacitor-healthkit doesn't have a Package.swift and
//  therefore doesn't link on Capacitor 8's SPM build path.
//
//  Registers as JS name "CapacitorHealthkit" so the existing
//  TypeScript bridge in frontend/src/lib/healthkit.ts keeps working
//  without changes.
//
//  Supports the metric types the app actually reads (steps, HR, HRV,
//  RHR, respiratory rate, SpO2, VO2 max, body mass, body fat, BP,
//  sleep analysis). Easily extended by adding a case to hkType(for:).

import Foundation
import Capacitor
import HealthKit

@objc(HealthKitPlugin)
public class HealthKitPlugin: CAPPlugin {

    private let healthStore = HKHealthStore()

    // ── Type mapping ────────────────────────────────────────────────

    private func hkType(for name: String) -> HKSampleType? {
        switch name {
        case "stepCount":              return HKQuantityType.quantityType(forIdentifier: .stepCount)
        case "activeEnergyBurned":     return HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)
        case "restingHeartRate":       return HKQuantityType.quantityType(forIdentifier: .restingHeartRate)
        case "heartRateVariability":   return HKQuantityType.quantityType(forIdentifier: .heartRateVariabilitySDNN)
        case "respiratoryRate":        return HKQuantityType.quantityType(forIdentifier: .respiratoryRate)
        case "oxygenSaturation":       return HKQuantityType.quantityType(forIdentifier: .oxygenSaturation)
        case "vo2Max":                 return HKQuantityType.quantityType(forIdentifier: .vo2Max)
        case "weight":                 return HKQuantityType.quantityType(forIdentifier: .bodyMass)
        case "bodyFatPercentage":      return HKQuantityType.quantityType(forIdentifier: .bodyFatPercentage)
        case "bloodPressureSystolic":  return HKQuantityType.quantityType(forIdentifier: .bloodPressureSystolic)
        case "bloodPressureDiastolic": return HKQuantityType.quantityType(forIdentifier: .bloodPressureDiastolic)
        case "sleepAnalysis":          return HKCategoryType.categoryType(forIdentifier: .sleepAnalysis)
        default:                       return nil
        }
    }

    private func unit(for name: String) -> HKUnit {
        switch name {
        case "stepCount":              return .count()
        case "activeEnergyBurned":     return .kilocalorie()
        case "restingHeartRate":       return HKUnit.count().unitDivided(by: .minute())
        case "heartRateVariability":   return .secondUnit(with: .milli)
        case "respiratoryRate":        return HKUnit.count().unitDivided(by: .minute())
        case "oxygenSaturation":       return .percent()
        case "vo2Max":                 return HKUnit(from: "ml/(kg*min)")
        case "weight":                 return .gramUnit(with: .kilo)
        case "bodyFatPercentage":      return .percent()
        case "bloodPressureSystolic":  return .millimeterOfMercury()
        case "bloodPressureDiastolic": return .millimeterOfMercury()
        default:                       return .count()
        }
    }

    // ── Public: requestAuthorization ────────────────────────────────

    @objc func requestAuthorization(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("HealthKit not available on this device")
            return
        }
        let readNames = call.getArray("read", String.self) ?? []
        var readTypes = Set<HKObjectType>()
        for n in readNames {
            if let t = hkType(for: n) { readTypes.insert(t) }
        }
        if readTypes.isEmpty {
            call.reject("No recognized read types requested")
            return
        }
        healthStore.requestAuthorization(toShare: nil, read: readTypes) { success, error in
            if let error = error {
                call.reject("HealthKit auth failed: \(error.localizedDescription)")
            } else {
                call.resolve(["granted": success])
            }
        }
    }

    // ── Public: queryHKitSampleType ─────────────────────────────────

    @objc func queryHKitSampleType(_ call: CAPPluginCall) {
        guard let sampleName = call.getString("sampleName"),
              let startISO   = call.getString("startDate"),
              let endISO     = call.getString("endDate"),
              let sampleType = hkType(for: sampleName) else {
            call.reject("Missing or invalid sampleName / startDate / endDate")
            return
        }
        let limit = call.getInt("limit") ?? HKObjectQueryNoLimit

        // Accept the ISO-with-milliseconds format the JS sends.
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let isoNoFrac = ISO8601DateFormatter()
        isoNoFrac.formatOptions = [.withInternetDateTime]
        let startDate = iso.date(from: startISO) ?? isoNoFrac.date(from: startISO) ?? Date.distantPast
        let endDate   = iso.date(from: endISO)   ?? isoNoFrac.date(from: endISO)   ?? Date.distantFuture

        let predicate = HKQuery.predicateForSamples(withStart: startDate, end: endDate, options: [])
        let sort = [NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: true)]
        let query = HKSampleQuery(sampleType: sampleType,
                                  predicate: predicate,
                                  limit: limit,
                                  sortDescriptors: sort) { [weak self] _, samples, error in
            guard let self = self else { return }
            if let error = error {
                call.reject("Query failed: \(error.localizedDescription)")
                return
            }
            let out = ISO8601DateFormatter()
            out.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

            let sampleUnit = self.unit(for: sampleName)
            var results: [[String: Any]] = []

            for sample in samples ?? [] {
                var row: [String: Any] = [
                    "startDate":  out.string(from: sample.startDate),
                    "endDate":    out.string(from: sample.endDate),
                    "sourceName": sample.sourceRevision.source.name,
                ]
                if let q = sample as? HKQuantitySample {
                    row["value"]    = q.quantity.doubleValue(for: sampleUnit)
                    row["unitName"] = sampleUnit.unitString
                } else if let c = sample as? HKCategorySample {
                    // For sleep analysis, encode the stage as the canonical
                    // string name our TS parser expects.
                    if sampleName == "sleepAnalysis" {
                        row["value"] = self.sleepValueString(c.value)
                    } else {
                        row["value"] = c.value
                    }
                }
                results.append(row)
            }
            call.resolve(["resultData": results])
        }
        healthStore.execute(query)
    }

    // ── Sleep value mapping ─────────────────────────────────────────

    private func sleepValueString(_ value: Int) -> String {
        switch value {
        case HKCategoryValueSleepAnalysis.inBed.rawValue:
            return "HKCategoryValueSleepAnalysisInBed"
        case HKCategoryValueSleepAnalysis.awake.rawValue:
            return "HKCategoryValueSleepAnalysisAwake"
        case HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue:
            return "HKCategoryValueSleepAnalysisAsleepUnspecified"
        default:
            // iOS 16+ enum values — reference by numeric raw value so this
            // compiles on older SDKs.
            switch value {
            case 3: return "HKCategoryValueSleepAnalysisAsleepCore"
            case 4: return "HKCategoryValueSleepAnalysisAsleepDeep"
            case 5: return "HKCategoryValueSleepAnalysisAsleepREM"
            default: return "HKCategoryValueSleepAnalysisUnknown"
            }
        }
    }
}
