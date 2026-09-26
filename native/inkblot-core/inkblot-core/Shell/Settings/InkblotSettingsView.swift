import SwiftUI

/// Inkblot ▸ Settings… (⌘,).
///
/// Only what the shell owns. The page's own settings — theme, accent, fonts — are the
/// page's, and stay in its menus.
struct InkblotSettingsView: View {
    var body: some View {
        TabView {
            Tab("Writing", systemImage: "chart.bar.xaxis") {
                WritingStatsSettings()
            }
            Tab("Goals", systemImage: "target") {
                GoalSettings()
            }
            Tab("Timers", systemImage: "timer") {
                TimerSettings()
            }
            Tab("Reminders", systemImage: "bell") {
                ReminderSettings()
            }
        }
        .frame(width: 580, height: 620)
        .scenePadding()
    }
}

/// How sittings are measured. Each change is saved as it is made; the tracker reads the
/// config live, so it applies to the session in progress too.
private struct WritingStatsSettings: View {
    @Environment(AppModel.self) private var model
    @State private var confirmingReset = false

    var body: some View {
        let stats = model.stats
        Form {
            Section {
                Picker("End a session after", selection: binding(\.idleCutoff)) {
                    ForEach([60.0, 120, 300, 600, 900, 1800], id: \.self) { seconds in
                        Text(minutes(seconds)).tag(seconds)
                    }
                }
                Picker("Count pauses as typing up to", selection: binding(\.activeGap)) {
                    ForEach([5.0, 10, 15, 30, 60, 120], id: \.self) { seconds in
                        Text(seconds < 60 ? "\(Int(seconds)) seconds" : minutes(seconds)).tag(seconds)
                    }
                }
                Picker("Keep sessions shorter than that only with writing", selection: binding(\.minimumSession)) {
                    ForEach([0.0, 15, 30, 60, 120], id: \.self) { seconds in
                        Text(seconds == 0 ? "Keep every session" : seconds < 60 ? "\(Int(seconds)) seconds" : minutes(seconds)).tag(seconds)
                    }
                }
            } header: {
                Text("Sessions")
            } footer: {
                Text("A session ends when you move to another document, or have been away longer than this. Time between edits counts as typing when the gap is shorter than the pause setting.")
            }

            Section {
                Toggle("Count pasted words as written", isOn: binding(\.countPastedWords))
            } footer: {
                Text("Pasted and dropped words are always kept, and shown apart. This decides whether they count toward words written.")
            }

            Section {
                Button("Reset Writing Stats…", role: .destructive) { confirmingReset = true }
            } footer: {
                Text("Stats are kept on this Mac, not in your projects.")
            }
        }
        .formStyle(.grouped)
        .confirmationDialog("Reset all writing stats?", isPresented: $confirmingReset) {
            Button("Reset Everything", role: .destructive) {
                stats.endSession()
                model.statsService.reset(StatsScope(project: nil, docPath: nil))
                stats.noteStoreChanged()
            }
            if let project = stats.project {
                Button("Reset \(project) Only", role: .destructive) {
                    stats.endSession()
                    model.statsService.reset(StatsScope(project: project, docPath: nil))
                    stats.noteStoreChanged()
                }
            }
        } message: {
            Text("Every session, and the totals made from them, is removed. This cannot be undone.")
        }
    }

    private func binding<T: Equatable>(_ keyPath: WritableKeyPath<StatsConfig, T>) -> Binding<T> {
        Binding(
            get: { model.stats.config[keyPath: keyPath] },
            set: { value in
                // A write of the same value must not save; see `GoalSettings.binding`.
                guard value != model.stats.config[keyPath: keyPath] else { return }
                model.stats.config[keyPath: keyPath] = value
                model.saveStatsConfig()
            })
    }

    private func minutes(_ seconds: Double) -> String {
        let minutes = Int(seconds / 60)
        return minutes == 1 ? "1 minute" : "\(minutes) minutes"
    }
}
