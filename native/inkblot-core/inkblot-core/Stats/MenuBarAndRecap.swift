import SwiftUI

/* ============================================================
   The menu bar
   ============================================================ */

/// The menu bar's label: the running segment's clock, or today's words against the
/// goal.
///
/// **Reads only what changes rarely.** Every change here is a new title for an
/// `NSStatusItem`, and AppKit lays the menu bar out again for each — including while the
/// extra is not inserted, where re-titling it every second brought the app down. So
/// while the extra is off the label is fixed; while it is on it reads the timer's
/// state and segment (which change at transitions), `Text(timerInterval:)` for the
/// countdown (which updates itself), and `GoalsModel.menuBarSummary` (which changes
/// when the words do) — never the per-second figures.
struct StatsMenuBarLabel: View {
    let model: AppModel

    var body: some View {
        let timer = model.timer
        if !model.stats.config.menuBarExtra {
            Image(systemName: "pencil.line")
        } else if timer.isActive, let segment = timer.segment {
            HStack(spacing: 4) {
                Image(systemName: timer.state == .paused ? "pause.circle" : segment.kind.symbol)
                if timer.state == .running, let deadline = timer.deadline {
                    // Counts itself down; the label needs no clock of its own.
                    Text(timerInterval: Date()...max(Date(), deadline), countsDown: true).monospacedDigit()
                } else {
                    Text(TimerText.clock(timer, segment: segment, at: Date())).monospacedDigit()
                }
            }
        } else {
            if let summary = model.goals.menuBarSummary {
                Label("\(summary.words.formatted())/\(summary.target.formatted())",
                      systemImage: summary.met ? "checkmark.seal.fill" : "pencil.line")
            } else {
                Image(systemName: "pencil.line")
            }
        }
    }
}

/// What the menu bar opens: today's goal, the streak, and the timer.
struct StatsMenuBarPanel: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let goals = model.goals
        let timer = model.timer
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Today").font(.headline)
                Spacer()
                Label("\(goals.streak.current)", systemImage: goals.streak.todayCounts ? "flame.fill" : "flame")
                    .foregroundStyle(goals.streak.todayCounts ? Color.accentColor : .secondary)
                    .help("Streak")
            }
            if goals.status.targets.isEmpty {
                Text("\(goals.today.words.formatted()) words written today")
                    .foregroundStyle(.secondary)
            } else {
                GoalRings(status: goals.status)
            }
            Divider()
            if timer.isActive, let segment = timer.segment {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    HStack {
                        Label(segment.title, systemImage: segment.kind.symbol)
                        Spacer()
                        Text(TimerText.clock(timer, segment: segment, at: context.date))
                            .font(.title3.weight(.semibold))
                            .monospacedDigit()
                    }
                }
                HStack {
                    switch timer.state {
                    case .waiting: Button("Start \(segment.title)") { timer.proceed() }
                    case .paused: Button("Resume") { timer.resume() }
                    default: Button("Pause") { timer.pause() }
                    }
                    Button("Skip") { timer.skip() }.disabled(timer.state == .waiting)
                    Spacer()
                    Button("Stop", role: .destructive) { timer.stop() }
                }
                .controlSize(.small)
            } else {
                Menu("Start a Routine") {
                    ForEach(model.stats.config.allRoutines) { routine in
                        Button(routine.name) { model.startTimer(routine) }
                    }
                }
                Button("Start \(model.defaultRoutine.name)") { model.startTimer(model.defaultRoutine) }
                    .buttonStyle(.borderedProminent)
            }
            Divider()
            Button("Show Stats in Inkblot") {
                #if os(macOS)
                NSApp.activate()
                #endif
                model.showStats()
            }
            .buttonStyle(.link)
        }
        .padding(14)
        .frame(width: 280)
    }
}

/* ============================================================
   The recap
   ============================================================ */

/// When a routine runs to its end: what it came to, and where the day stands.
struct TimerRecapView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let run: WritingTimer.Run

    var body: some View {
        let goals = model.goals
        let pace = run.writeSecs >= 30 ? Int((Double(run.wordsWritten) / (run.writeSecs / 60)).rounded()) : nil
        VStack(spacing: 18) {
            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: 44))
                .foregroundStyle(Color.accentColor)
                .symbolEffect(.bounce, value: run.id)
            VStack(spacing: 4) {
                Text("\(run.routine.name) complete").font(.title2.weight(.semibold))
                Text("\(StatsFormat.duration(run.writeSecs)) of writing, \(StatsFormat.duration(run.breakSecs)) of breaks")
                    .foregroundStyle(.secondary)
            }
            Grid(horizontalSpacing: 24, verticalSpacing: 10) {
                GridRow {
                    figure(run.wordsWritten.formatted(), "words")
                    figure(pace.map { $0.formatted() } ?? "—", "words a minute")
                    figure("\(run.sprintsCompleted)", run.sprintsCompleted == 1 ? "sprint" : "sprints")
                }
            }
            VStack(spacing: 4) {
                if let met = goals.status.met {
                    Label(met ? "Today’s goal is met." : (goals.status.remainingText.map { $0.prefix(1).uppercased() + $0.dropFirst() + " today." } ?? ""),
                          systemImage: met ? "checkmark.circle.fill" : "target")
                }
                if goals.streak.current > 0 {
                    Label("\(goals.streak.current)-day streak", systemImage: "flame.fill")
                }
            }
            .foregroundStyle(.secondary)
            HStack {
                Button("Run Again") {
                    dismiss()
                    model.startTimer(run.routine)
                }
                Button("Done") { dismiss() }
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(28)
        .frame(width: 380)
    }

    private func figure(_ value: String, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text(value).font(.system(size: 26, weight: .semibold, design: .rounded)).monospacedDigit()
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
    }
}
