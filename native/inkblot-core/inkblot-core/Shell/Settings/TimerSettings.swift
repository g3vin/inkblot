import SwiftUI

/// Settings ▸ Timers: the routines, and how the timer is heard.
///
/// The built-in routines are shown as they are and cannot be changed — Duplicate makes
/// one that can. Every edit is saved as it is made; a routine that is running keeps the
/// shape it started with, and the next run takes the new one.
struct TimerSettings: View {
    @Environment(AppModel.self) private var model
    @State private var selection: UUID?

    var body: some View {
        let config = model.stats.config
        Form {
            Section {
                Toggle("Notify when a segment ends", isOn: configBinding(\.timerNotifications))
                Toggle("Play each segment’s sound", isOn: configBinding(\.timerSounds))
            } footer: {
                Text("Notifications reach you in other apps, so a break ends where you are.")
            }

            Section {
                Toggle("Sprint mode", isOn: configBinding(\.sprintFocus))
                Toggle("Show the timer and today’s goal in the menu bar", isOn: configBinding(\.menuBarExtra))
            } footer: {
                Text("In sprint mode a writing segment turns on focus mode and puts the file tree and the inspector away, and a break brings them back.")
            }

            Section("Routines") {
                Picker("Routine", selection: Binding(
                    get: { selection ?? config.allRoutines.first?.id },
                    set: { selection = $0 })
                ) {
                    RoutineOptions(routines: config.allRoutines)
                }
                HStack {
                    Button("New Routine", systemImage: "plus") { add(WritingRoutine(
                        id: UUID(), name: "My Routine", segments: [.write(30), .rest(5)])) }
                    Button("Duplicate", systemImage: "plus.square.on.square") {
                        if let routine = selected { add(routine.duplicate()) }
                    }
                    Spacer()
                    Button("Delete", systemImage: "trash", role: .destructive) { deleteSelected() }
                        .disabled(selected?.isBuiltIn ?? true)
                }
                .controlSize(.small)
            }

            if let routine = selected {
                if routine.isBuiltIn {
                    BuiltInRoutine(routine: routine)
                } else {
                    RoutineEditor(routine: routineBinding(routine.id))
                }
            }
        }
        .formStyle(.grouped)
    }

    private var selected: WritingRoutine? {
        let config = model.stats.config
        return config.routine(selection) ?? config.allRoutines.first
    }

    private func add(_ routine: WritingRoutine) {
        model.stats.config.routines.append(routine)
        model.saveStatsConfig()
        selection = routine.id
    }

    private func deleteSelected() {
        guard let routine = selected, !routine.isBuiltIn else { return }
        model.stats.config.routines.removeAll { $0.id == routine.id }
        if model.stats.config.lastRoutineID == routine.id { model.stats.config.lastRoutineID = nil }
        model.saveStatsConfig()
        selection = nil
    }

    private func routineBinding(_ id: UUID) -> Binding<WritingRoutine> {
        Binding(
            get: { model.stats.config.routines.first { $0.id == id } ?? .sprint },
            set: { edited in
                guard let index = model.stats.config.routines.firstIndex(where: { $0.id == id }),
                      model.stats.config.routines[index] != edited else { return }
                model.stats.config.routines[index] = edited
                model.saveStatsConfig()
            })
    }

    private func configBinding(_ keyPath: WritableKeyPath<StatsConfig, Bool>) -> Binding<Bool> {
        Binding(
            get: { model.stats.config[keyPath: keyPath] },
            set: { value in
                guard value != model.stats.config[keyPath: keyPath] else { return }
                model.stats.config[keyPath: keyPath] = value
                model.saveStatsConfig()
                if keyPath == \.timerNotifications, value { model.timerAnnouncer.requestPermission() }
            })
    }
}

/// A built-in routine, read-only.
private struct BuiltInRoutine: View {
    let routine: WritingRoutine

    var body: some View {
        Section {
            ForEach(routine.segments) { segment in
                LabeledContent {
                    Text(SegmentText.length(segment)).monospacedDigit()
                } label: {
                    Label(segment.title, systemImage: segment.kind.symbol)
                }
            }
        } header: {
            Text(routine.name)
        } footer: {
            Text("Built-in routines can’t be changed. Duplicate this one to make your own.")
        }
    }
}

/// A routine of the writer's, every part of it editable.
private struct RoutineEditor: View {
    @Binding var routine: WritingRoutine

    var body: some View {
        Section("Routine") {
            TextField("Name", text: $routine.name)
            Picker("Run", selection: $routine.repeats) {
                Text("Once").tag(1)
                ForEach(2...10, id: \.self) { Text("\($0) times").tag($0) }
                Text("Until stopped").tag(0)
            }
            Toggle("Start the next segment on its own", isOn: $routine.autoAdvance)
            Toggle("Pause open time during breaks", isOn: $routine.pauseTrackingOnBreaks)
        }

        Section {
            ForEach($routine.segments) { $segment in
                SegmentRow(
                    segment: $segment,
                    canMoveUp: routine.segments.first?.id != segment.id,
                    canMoveDown: routine.segments.last?.id != segment.id,
                    canDelete: routine.segments.count > 1,
                    move: { offset in move(segment.id, by: offset) },
                    delete: { routine.segments.removeAll { $0.id == segment.id } })
            }
            HStack {
                Button("Add Writing", systemImage: "pencil") { routine.segments.append(.write(25)) }
                Button("Add Break", systemImage: "cup.and.saucer") { routine.segments.append(.rest(5)) }
            }
            .controlSize(.small)
        } header: {
            Text("Segments")
        } footer: {
            Text(TimerText.plan(routine))
        }
    }

    private func move(_ id: UUID, by offset: Int) {
        guard let index = routine.segments.firstIndex(where: { $0.id == id }) else { return }
        let target = index + offset
        guard routine.segments.indices.contains(target) else { return }
        routine.segments.swapAt(index, target)
    }
}

private struct SegmentRow: View {
    @Binding var segment: TimerSegment
    let canMoveUp: Bool
    let canMoveDown: Bool
    let canDelete: Bool
    let move: (Int) -> Void
    let delete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Picker("Kind", selection: $segment.kind) {
                    ForEach(TimerSegment.Kind.allCases) { Label($0.title, systemImage: $0.symbol).tag($0) }
                }
                .labelsHidden()
                .fixedSize()
                TextField("Label", text: $segment.label, prompt: Text(segment.kind.title))
                Menu {
                    Button("Move Up", systemImage: "arrow.up") { move(-1) }.disabled(!canMoveUp)
                    Button("Move Down", systemImage: "arrow.down") { move(1) }.disabled(!canMoveDown)
                    Divider()
                    Button("Delete", systemImage: "trash", role: .destructive, action: delete).disabled(!canDelete)
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .menuStyle(.borderlessButton)
                .fixedSize()
            }
            HStack(spacing: 12) {
                Toggle("Clock", isOn: Binding(
                    get: { segment.minutes != nil },
                    set: { segment.minutes = $0 ? (segment.minutes ?? 25) : nil }))
                    .toggleStyle(.checkbox)
                if segment.minutes != nil {
                    Stepper(value: Binding(get: { segment.minutes ?? 25 }, set: { segment.minutes = $0 }), in: 1...240) {
                        Text("\(segment.minutes ?? 25) min").monospacedDigit()
                    }
                    .fixedSize()
                }
                if segment.kind == .write {
                    TextField("Word goal", value: $segment.wordGoal, format: .number, prompt: Text("Word goal"))
                        .frame(width: 90)
                        .help(segment.minutes == nil
                              ? "With no clock, the segment ends when you reach this many words."
                              : "A target to write toward. The clock still ends the segment.")
                }
                Spacer()
                Picker("Sound", selection: $segment.sound) {
                    ForEach(TimerSound.allCases) { Text($0.title).tag($0) }
                }
                .labelsHidden()
                .fixedSize()
                .help("Played when this segment begins")
            }
            .controlSize(.small)
            if segment.minutes == nil, segment.wordGoal == nil {
                Text("No clock and no goal: this segment runs until you skip it.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
    }
}

enum SegmentText {
    static func length(_ segment: TimerSegment) -> String {
        if let minutes = segment.minutes { return "\(minutes) min" }
        if let goal = segment.wordGoal { return "\(goal.formatted()) words" }
        return "Until skipped"
    }
}
