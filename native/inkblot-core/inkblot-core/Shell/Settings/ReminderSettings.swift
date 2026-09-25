import SwiftUI

/// Settings ▸ Reminders: when Inkblot reminds the writer to write, and when it keeps
/// quiet.
struct ReminderSettings: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Form {
            Section {
                ForEach(model.stats.config.reminders) { reminder in
                    if let index = model.stats.config.reminders.firstIndex(where: { $0.id == reminder.id }) {
                        ReminderRow(reminder: binding(\.reminders[index])) {
                            model.stats.config.reminders.removeAll { $0.id == reminder.id }
                            model.saveStatsConfig()
                        }
                    }
                }
                Menu("Add Reminder", systemImage: "bell.badge") {
                    Button("Time to Write") { add(.write, hour: 9) }
                    Button("Goal Not Met Yet") { add(.goalNudge, hour: 19) }
                    Button("Streak at Risk") { add(.streakAtRisk, hour: 21) }
                }
                .fixedSize()
            } header: {
                Text("Reminders")
            } footer: {
                Text("“Goal not met yet” says how far off today’s goal is, and is withdrawn once it’s met. “Streak at risk” comes only on a day that doesn’t count yet. Every reminder offers Start Sprint.")
            }

            Section {
                Toggle("Quiet hours", isOn: binding(\.quietHours.enabled))
                if model.stats.config.quietHours.enabled {
                    Picker("From", selection: binding(\.quietHours.startHour)) {
                        ForEach(0..<24, id: \.self) { Text(hourLabel($0)).tag($0) }
                    }
                    Picker("Until", selection: binding(\.quietHours.endHour)) {
                        ForEach(0..<24, id: \.self) { Text(hourLabel($0)).tag($0) }
                    }
                }
            } footer: {
                Text("No reminder is sent in quiet hours.")
            }
        }
        .formStyle(.grouped)
    }

    private func add(_ kind: Reminder.Kind, hour: Int) {
        model.stats.config.reminders.append(Reminder(kind: kind, hour: hour, minute: 0))
        model.saveStatsConfig()
        model.timerAnnouncer.requestPermission()
    }

    private func hourLabel(_ hour: Int) -> String {
        (Calendar.current.date(bySettingHour: hour, minute: 0, second: 0, of: Date()) ?? Date())
            .formatted(date: .omitted, time: .shortened)
    }

    /// Saves on a change, and only on one: a control that writes back the value it was
    /// given must not save — the save is observed, and would loop.
    private func binding<T: Equatable>(_ keyPath: WritableKeyPath<StatsConfig, T>) -> Binding<T> {
        Binding(
            get: { model.stats.config[keyPath: keyPath] },
            set: { value in
                guard value != model.stats.config[keyPath: keyPath] else { return }
                model.stats.config[keyPath: keyPath] = value
                model.saveStatsConfig()
            })
    }
}

private struct ReminderRow: View {
    @Binding var reminder: Reminder
    let delete: () -> Void

    var body: some View {
        let calendar = Calendar.current
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Toggle(isOn: $reminder.enabled) {
                    Text(reminder.kind.title).font(.headline)
                }
                Spacer()
                DatePicker("Time", selection: Binding(
                    get: { calendar.date(bySettingHour: reminder.hour, minute: reminder.minute, second: 0, of: Date()) ?? Date() },
                    set: { date in
                        reminder.hour = calendar.component(.hour, from: date)
                        reminder.minute = calendar.component(.minute, from: date)
                    }), displayedComponents: .hourAndMinute)
                    .labelsHidden()
                Button("Delete", systemImage: "trash", role: .destructive, action: delete)
                    .labelStyle(.iconOnly)
                    .buttonStyle(.borderless)
            }
            WeekdayToggles(selection: $reminder.weekdays, calendar: calendar)
            TextField("Message", text: $reminder.message, prompt: Text("Inkblot’s own words"))
        }
        .padding(.vertical, 2)
        .opacity(reminder.enabled ? 1 : 0.6)
    }
}
