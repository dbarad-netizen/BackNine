// SignInView.swift
//
// First-launch screen. Asks the user to paste their X-AH-Key from the
// BackNine web app. Saves to Keychain via SettingsStore. After save,
// the root view switches to ContentView automatically.
//
// Deliberately bare — no auth flow, no email/password, no SSO. The key
// IS the auth. BackNine generates it server-side and shows it on the
// Apple Health tab of the web app.

import SwiftUI

struct SignInView: View {
    @EnvironmentObject var settings: SettingsStore
    @State private var key: String = ""
    @State private var showInstructions: Bool = false

    var body: some View {
        VStack(spacing: 24) {
            // Hero
            VStack(spacing: 12) {
                Image(systemName: "heart.circle.fill")
                    .font(.system(size: 64))
                    .foregroundColor(brandGreen)
                Text("BackNine Health Sync")
                    .font(.system(size: 22, weight: .bold))
                Text("Connect your Apple Health data to BackNine in one tap.")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }
            .padding(.top, 48)

            Spacer(minLength: 0)

            // Key entry
            VStack(alignment: .leading, spacing: 8) {
                Text("Paste your sync key")
                    .font(.caption.weight(.semibold))
                    .foregroundColor(.secondary)
                    .textCase(.uppercase)

                TextField("bn_xxxx-xxxx-xxxx-xxxx", text: $key)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .padding(12)
                    .background(Color(.systemGray6))
                    .cornerRadius(12)
                    .font(.system(.body, design: .monospaced))

                Button {
                    showInstructions.toggle()
                } label: {
                    Label(
                        showInstructions ? "Hide instructions" : "Where do I find my key?",
                        systemImage: "info.circle"
                    )
                    .font(.caption)
                    .foregroundColor(brandGreen)
                }
            }
            .padding(.horizontal, 24)

            if showInstructions {
                VStack(alignment: .leading, spacing: 6) {
                    instruction("1. Open BackNine on the web (back-nine-d28t.vercel.app)")
                    instruction("2. Tap the Apple Health tab")
                    instruction("3. Copy the X-AH-Key value")
                    instruction("4. Paste it above and tap Connect")
                }
                .font(.caption)
                .foregroundColor(.secondary)
                .padding(.horizontal, 24)
                .transition(.opacity)
            }

            Spacer()

            Button(action: connect) {
                Text("Connect")
                    .font(.system(size: 16, weight: .semibold))
                    .frame(maxWidth: .infinity)
                    .padding(14)
                    .background(canConnect ? brandGreen : Color.gray.opacity(0.3))
                    .foregroundColor(.white)
                    .cornerRadius(14)
            }
            .disabled(!canConnect)
            .padding(.horizontal, 24)
            .padding(.bottom, 24)
        }
    }

    private var canConnect: Bool {
        key.trimmingCharacters(in: .whitespacesAndNewlines).count > 0
    }

    private func connect() {
        settings.setAPIKey(key)
    }

    private func instruction(_ text: String) -> some View {
        Text(text)
    }

    private var brandGreen: Color {
        // #1B3829 — the canonical BackNine brand color.
        Color(red: 27/255, green: 56/255, blue: 41/255)
    }
}
