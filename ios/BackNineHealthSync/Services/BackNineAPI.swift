// BackNineAPI.swift
//
// One HTTP call: POST /api/apple-health/sync with the user's X-AH-Key
// and a flat JSON body of yesterday's metrics. Mirrors the Shortcut
// payload shape so the existing backend handler `apple_health.sync_day`
// works without changes.

import Foundation

enum BackNineAPI {
    /// Production backend. Override in scheme env vars for local dev.
    static var baseURL: URL {
        if let override = ProcessInfo.processInfo.environment["BACKNINE_API"],
           let url = URL(string: override) {
            return url
        }
        return URL(string: "https://backnine-hu60.onrender.com")!
    }

    enum APIError: Error, LocalizedError {
        case missingKey
        case http(status: Int, body: String?)
        case transport(Error)

        var errorDescription: String? {
            switch self {
            case .missingKey:                  return "Not signed in (no X-AH-Key)"
            case .http(let s, let b):          return "HTTP \(s)" + (b.map { " · \($0)" } ?? "")
            case .transport(let e):            return "Network error: \(e.localizedDescription)"
            }
        }
    }

    /// POST a single day's metrics. `payload` is built by HealthKitManager
    /// from yesterday's HealthKit reads; only metrics with values are
    /// included so the backend never sees `null`s it has to handle.
    static func sync(payload: [String: Any], apiKey: String) async throws {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/apple-health/sync"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(apiKey, forHTTPHeaderField: "X-AH-Key")
        req.timeoutInterval = 30

        do {
            req.httpBody = try JSONSerialization.data(withJSONObject: payload, options: [])
        } catch {
            throw APIError.transport(error)
        }

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await URLSession.shared.data(for: req)
        } catch {
            throw APIError.transport(error)
        }

        guard let http = response as? HTTPURLResponse else {
            throw APIError.http(status: 0, body: nil)
        }
        guard (200..<300).contains(http.statusCode) else {
            let body = String(data: data, encoding: .utf8)
            throw APIError.http(status: http.statusCode, body: body)
        }
    }
}
