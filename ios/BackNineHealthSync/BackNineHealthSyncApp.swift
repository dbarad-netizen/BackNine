// BackNineHealthSyncApp.swift
//
// @main entry point. Sets up the root SwiftUI scene and decides between
// the sign-in view (first launch / no key stored) and the main content
// view (already configured). Also kicks off HealthKit authorization and
// background-delivery registration on launch.

import SwiftUI
import HealthKit
import BackgroundTasks

@main
struct BackNineHealthSyncApp: App {
    // Single shared instances for the lifetime of the app — passed into
    // views via environmentObject so we don't re-init HealthKit / API
    // clients on every redraw.
    @StateObject private var settings  = SettingsStore.shared
    @StateObject private var healthKit = HealthKitManager.shared

    /// Background task identifier — must also be listed in Info.plist under
    /// `BGTaskSchedulerPermittedIdentifiers`. iOS uses this to wake the app
    /// for periodic syncs even when the user hasn't opened it for days.
    static let backgroundTaskID = "com.backnine.sync.refresh"

    init() {
        registerBackgroundTasks()
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if settings.apiKey == nil {
                    SignInView()
                } else {
                    ContentView()
                }
            }
            .environmentObject(settings)
            .environmentObject(healthKit)
            .onAppear { syncIfReady() }
            .onChange(of: settings.apiKey) { _ in syncIfReady() }
        }
    }

    /// Fire a sync attempt if we have a key and HealthKit auth. Best-effort:
    /// if auth hasn't been granted yet, this no-ops; user gets nudged in
    /// ContentView to grant permissions.
    private func syncIfReady() {
        guard settings.apiKey != nil else { return }
        Task { await healthKit.requestAuthorizationIfNeeded() }
        Task { await healthKit.syncYesterday() }
        scheduleNextBackgroundRefresh()
    }

    // MARK: - Background scheduling

    /// Register the handler for our background task identifier. Must be
    /// called before `application(_:didFinishLaunchingWithOptions:)` returns,
    /// which is why this is in `init()`.
    private func registerBackgroundTasks() {
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: Self.backgroundTaskID,
            using: nil
        ) { task in
            Self.handleBackgroundRefresh(task: task as! BGAppRefreshTask)
        }
    }

    private static func handleBackgroundRefresh(task: BGAppRefreshTask) {
        // Re-schedule the next refresh first so we don't drop the loop.
        scheduleNextBackgroundRefresh()

        // The work itself — sync yesterday's data and report back.
        let work = Task {
            await HealthKitManager.shared.syncYesterday()
        }

        // If iOS revokes background time before we finish, cancel.
        task.expirationHandler = { work.cancel() }
        Task {
            _ = await work.value
            task.setTaskCompleted(success: true)
        }
    }

    /// Ask iOS to wake us roughly hourly. iOS may run us less often based
    /// on battery / focus / etc. — that's expected and OK; even one wake
    /// per day keeps the data fresh.
    private static func scheduleNextBackgroundRefresh() {
        let request = BGAppRefreshTaskRequest(identifier: backgroundTaskID)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 60 * 60) // 1 hour
        try? BGTaskScheduler.shared.submit(request)
    }
}
