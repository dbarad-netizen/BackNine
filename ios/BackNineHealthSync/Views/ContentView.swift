// ContentView.swift
//
// Main screen shown after sign-in. Single hero stat: "Last sync · 3 min ago"
// plus a Sync now button and a navigation link to the per-metric detail.
// Apple loves narrow-purpose apps; this screen is intentionally minimal so
// App Store review sees one thing happening clearly.

import SwiftUI

struct ContentView: View {
    @EnvironmentObject var settings:  SettingsStore
    @EnvironmentObject var healthKit: HealthKitManager

    @State private var isSyncing: Bool = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                statusCard
                    .padding(.top, 32)
                    .padding(.horizontal, 20)

                Spacer()

                NavigationLink(destination: MetricsDetailView()) {
                    HStack {
                        Image(systemName: "list.bullet")
                        Text("What's syncing")
                        Spacer()
                        Image(systemName: "chevron.right").foregroundColor(.secondary)
                    }
                    .padding()
                    .background(Color(.systemGray6))
                    .cornerRadius(14)
                }
                .padding(.horizontal, 20)

                Button(role: .destructive) {
                    settings.clearAPIKey()
                } label: {
                    Text("Sign out")
                        .font(.callout)
                        .foregroundColor(.secondary)
                }
                .padding(.top, 16)
                .padding(.bottom, 24)
            }
            .navigationTitle("BackNine")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    // MARK: - Status card

    private var statusCard: some View {
        VStack(spacing: 16) {
            HStack {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundColor(brandGreen)
                Text("Connected")
                    .font(.system(size: 14, weight: .semibold))
                Spacer()
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(lastSyncLabel)
                    .font(.system(size: 28, weight: .bold))
                Text("Apple Health → BackNine, in the background")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            if let err = healthKit.lastError {
                Text(err)
                    .font(.caption2)
                    .foregroundColor(.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            Button(action: syncNow) {
                HStack {
                    if isSyncing {
                        ProgressView().tint(.white)
                    } else {
                        Image(systemName: "arrow.triangle.2.circlepath")
                    }
                    Text(isSyncing ? "Syncing…" : "Sync now")
                        .font(.system(size: 15, weight: .semibold))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .background(brandGreen)
                .foregroundColor(.white)
                .cornerRadius(12)
            }
            .disabled(isSyncing)
        }
        .padding(20)
        .background(Color(.systemBackground))
        .cornerRadius(20)
        .shadow(color: .black.opacity(0.05), radius: 12, y: 2)
    }

    private var lastSyncLabel: String {
        guard let last = settings.lastAnySync else {
            return "Waiting for first sync…"
        }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .full
        return "Last sync " + formatter.localizedString(for: last, relativeTo: Date())
    }

    private func syncNow() {
        isSyncing = true
        Task {
            await healthKit.syncYesterday()
            isSyncing = false
        }
    }

    private var brandGreen: Color {
        Color(red: 27/255, green: 56/255, blue: 41/255)
    }
}
