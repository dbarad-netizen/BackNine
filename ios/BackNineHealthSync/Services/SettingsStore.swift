// SettingsStore.swift
//
// Persistent state the app cares about: the X-AH-Key (in Keychain) and
// the last successful sync timestamp per metric (in UserDefaults).
//
// API key MUST live in Keychain — UserDefaults is plain text and would
// be visible to anything that backed up an unencrypted iCloud restore.
// Keychain is encrypted at rest and tied to the app's bundle ID.

import Foundation
import Combine
import Security

@MainActor
final class SettingsStore: ObservableObject {
    static let shared = SettingsStore()

    // MARK: - X-AH-Key (Keychain)

    /// The user's per-account BackNine API key. Set once during sign-in,
    /// read on every API call. nil means "not signed in yet."
    @Published private(set) var apiKey: String? = Keychain.get(.apiKey)

    func setAPIKey(_ key: String) {
        let trimmed = key.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        Keychain.set(trimmed, for: .apiKey)
        apiKey = trimmed
    }

    func clearAPIKey() {
        Keychain.delete(.apiKey)
        apiKey = nil
        lastSyncByMetric = [:]
        UserDefaults.standard.removeObject(forKey: "lastSyncByMetric")
    }

    // MARK: - Last sync (UserDefaults)

    /// Map of metric.rawValue → ISO8601 timestamp string. Surfaces on the
    /// detail screen so the user can see "Steps: synced 3 min ago".
    @Published var lastSyncByMetric: [String: String] = Self.loadLastSyncMap()

    func recordSync(_ metric: HealthMetric, at date: Date = Date()) {
        let iso = ISO8601DateFormatter().string(from: date)
        lastSyncByMetric[metric.rawValue] = iso
        UserDefaults.standard.set(lastSyncByMetric, forKey: "lastSyncByMetric")
    }

    /// Most-recent successful sync across any metric — drives the headline
    /// "Last sync · 3 min ago" on the main screen.
    var lastAnySync: Date? {
        let timestamps = lastSyncByMetric.values
            .compactMap { ISO8601DateFormatter().date(from: $0) }
        return timestamps.max()
    }

    private static func loadLastSyncMap() -> [String: String] {
        UserDefaults.standard.dictionary(forKey: "lastSyncByMetric") as? [String: String] ?? [:]
    }

    // MARK: - Per-metric toggles

    /// User can disable individual metrics from the detail screen. Anything
    /// not in this set is treated as enabled (default-on).
    @Published var disabledMetrics: Set<String> = Self.loadDisabled() {
        didSet {
            UserDefaults.standard.set(Array(disabledMetrics), forKey: "disabledMetrics")
        }
    }

    func isEnabled(_ metric: HealthMetric) -> Bool {
        !disabledMetrics.contains(metric.rawValue)
    }

    func setEnabled(_ metric: HealthMetric, enabled: Bool) {
        if enabled {
            disabledMetrics.remove(metric.rawValue)
        } else {
            disabledMetrics.insert(metric.rawValue)
        }
    }

    private static func loadDisabled() -> Set<String> {
        let arr = UserDefaults.standard.stringArray(forKey: "disabledMetrics") ?? []
        return Set(arr)
    }
}

// MARK: - Keychain helper

/// Thin wrapper over the Security framework. Apple's API is C-style and
/// painful; isolating it here keeps the rest of the app clean.
private enum Keychain {
    enum Key: String { case apiKey = "com.backnine.sync.apiKey" }

    static func get(_ key: Key) -> String? {
        let query: [String: Any] = [
            kSecClass as String:            kSecClassGenericPassword,
            kSecAttrAccount as String:      key.rawValue,
            kSecReturnData as String:       true,
            kSecMatchLimit as String:       kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data,
              let str = String(data: data, encoding: .utf8) else { return nil }
        return str
    }

    static func set(_ value: String, for key: Key) {
        delete(key)
        let data = Data(value.utf8)
        let attrs: [String: Any] = [
            kSecClass as String:            kSecClassGenericPassword,
            kSecAttrAccount as String:      key.rawValue,
            kSecValueData as String:        data,
            kSecAttrAccessible as String:   kSecAttrAccessibleAfterFirstUnlock,
        ]
        SecItemAdd(attrs as CFDictionary, nil)
    }

    static func delete(_ key: Key) {
        let query: [String: Any] = [
            kSecClass as String:       kSecClassGenericPassword,
            kSecAttrAccount as String: key.rawValue,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
