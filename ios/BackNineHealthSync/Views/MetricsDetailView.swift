// MetricsDetailView.swift
//
// Second screen — answers "what's actually being synced and when did each
// thing last update?" Per-metric toggles let users opt out of a metric
// (e.g. they don't want to share body weight). Disabled metrics are
// skipped on the next sync; existing data on the backend isn't deleted.

import SwiftUI

struct MetricsDetailView: View {
    @EnvironmentObject var settings: SettingsStore

    var body: some View {
        List {
            Section {
                ForEach(HealthMetric.allCases) { metric in
                    metricRow(metric)
                }
            } footer: {
                Text("Disabling a metric stops it on the next sync. Past data on BackNine stays where it is — to remove it, delete it from BackNine's Apple Health tab.")
                    .font(.caption2)
            }
        }
        .navigationTitle("What's syncing")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func metricRow(_ metric: HealthMetric) -> some View {
        HStack(spacing: 14) {
            Image(systemName: metric.icon)
                .foregroundColor(brandGreen)
                .frame(width: 24)

            VStack(alignment: .leading, spacing: 2) {
                Text(metric.displayName)
                    .font(.body)
                Text(syncStatusText(for: metric))
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }

            Spacer()

            Toggle("", isOn: Binding(
                get: { settings.isEnabled(metric) },
                set: { settings.setEnabled(metric, enabled: $0) }
            ))
            .labelsHidden()
            .tint(brandGreen)
        }
        .padding(.vertical, 4)
    }

    private func syncStatusText(for metric: HealthMetric) -> String {
        guard let iso = settings.lastSyncByMetric[metric.rawValue],
              let date = ISO8601DateFormatter().date(from: iso) else {
            return "Not synced yet"
        }
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .abbreviated
        return "Synced " + f.localizedString(for: date, relativeTo: Date())
    }

    private var brandGreen: Color {
        Color(red: 27/255, green: 56/255, blue: 41/255)
    }
}
