import SwiftUI

/// The writing timer as the Stats tab shows it: a routine to start, or the segment
/// running — its clock, its progress, its words — and the controls for it.
struct TimerSection: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let timer = model.timer
        Section("Timer") {
            if timer.isActive, let segment = timer.segment {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    RunningTimer(timer: timer, segment: segment, now: context.date)
                }
                TimerControls(timer: timer, segment: segment)
            } else {
                RoutineStarter()
            }
        }
    }
}

private struct RunningTimer: View {
    let timer: WritingTimer
    let segment: TimerSegment
    let now: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Label(segment.title, systemImage: segment.kind.symbol)
                    .font(.headline)
                Spacer()
                Text(timer.position)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Text(TimerText.clock(timer, segment: segment, at: now))
                .font(.system(size: 34, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(timer.state == .paused ? .secondary : .primary)
                .contentTransition(.numericText(countsDown: segment.duration != nil))
            if let progress = timer.progress(at: now), timer.state != .waiting {
                ProgressView(value: progress)
                    .tint(segment.kind == .write ? .accentColor : .secondary)
            }
            Group {
                switch timer.state {
                case .waiting:
                    Text("\(segment.title) is next. Start it when you’re ready.")
                case .paused:
                    Text("Paused.")
                default:
                    if segment.kind == .write {
                        Text(TimerText.words(timer.segmentWords, goal: segment.wordGoal))
                    } else {
                        Text(timer.routine?.pauseTrackingOnBreaks == true ? "Open time is paused for the break." : "On a break.")
                    }
                }
            }
            .font(.callout)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

private struct TimerControls: View {
    let timer: WritingTimer
    let segment: TimerSegment

    var body: some View {
        HStack {
            switch timer.state {
            case .waiting:
                Button("Start \(segment.title)", systemImage: "play.fill") { timer.proceed() }
                    .buttonStyle(.borderedProminent)
            case .paused:
                Button("Resume", systemImage: "play.fill") { timer.resume() }
                    .buttonStyle(.borderedProminent)
            default:
                Button("Pause", systemImage: "pause.fill") { timer.pause() }
            }
            if timer.state != .waiting {
                Button("Skip", systemImage: "forward.end.fill") { timer.skip() }
                    .help("End this segment now and go on to the next")
            }
            Spacer()
            Button("Stop", systemImage: "stop.fill", role: .destructive) { timer.stop() }
                .help("Stop the routine. What you wrote still counts.")
        }
        .controlSize(.small)
    }
}

/// A routine to run, and Start.
private struct RoutineStarter: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let routine = model.defaultRoutine
        Picker("Routine", selection: Binding(
            get: { routine.id },
            set: { id in
                // A picker may write back what it was given; that is not a choice.
                guard id != model.stats.config.lastRoutineID else { return }
                model.stats.config.lastRoutineID = id
                model.saveStatsConfig()
            })
        ) {
            RoutineOptions(routines: model.stats.config.allRoutines)
        }
        LabeledContent {
            Button("Start", systemImage: "play.fill") { model.startTimer(routine) }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
        } label: {
            Text(TimerText.plan(routine))
                .font(.callout)
                .foregroundStyle(.secondary)
        }
        if let run = model.timer.lastRun, run.end.timeIntervalSinceNow > -3600 {
            Text("Last run: \(run.routine.name), \(run.wordsWritten.formatted()) words in \(StatsFormat.duration(run.writeSecs)).")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}

/// The built-in routines, then the writer's, as picker rows.
struct RoutineOptions: View {
    let routines: [WritingRoutine]

    var body: some View {
        let builtIn = routines.filter(\.isBuiltIn)
        let own = routines.filter { !$0.isBuiltIn }
        Section {
            ForEach(builtIn) { Text($0.name).tag($0.id) }
        }
        if !own.isEmpty {
            Section("My Routines") {
                ForEach(own) { Text($0.name).tag($0.id) }
            }
        }
    }
}

/* ---------------- the toolbar ---------------- */

/// The toolbar's timer: a menu of routines while none is running, and the running
/// segment's clock, with its controls, while one is.
struct TimerToolbarControl: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let timer = model.timer
        Menu {
            TimerMenuItems(model: model)
        } label: {
            if timer.isActive, let segment = timer.segment {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    Label {
                        Text(TimerText.clock(timer, segment: segment, at: context.date)).monospacedDigit()
                    } icon: {
                        Image(systemName: timer.state == .paused ? "pause.circle" : segment.kind.symbol)
                    }
                    .labelStyle(.titleAndIcon)
                }
            } else {
                Label("Writing Timer", systemImage: "timer")
            }
        }
        .help(timer.isActive ? "The writing timer" : "Start a writing timer")
    }
}

/// The timer's commands: in the toolbar's menu and in the menu bar's Timer menu.
struct TimerMenuItems: View {
    /// Passed, not read from the environment: the menu bar's commands have none.
    let model: AppModel

    var body: some View {
        let timer = model.timer
        switch timer.state {
        case .idle:
            Button("Start \(model.defaultRoutine.name)") { model.startTimer(model.defaultRoutine) }
        case .running:
            Button("Pause") { timer.pause() }
        case .paused:
            Button("Resume") { timer.resume() }
        case .waiting:
            Button("Start \(timer.segment?.title ?? "Next Segment")") { timer.proceed() }
        }
        Button("Skip to Next Segment") { timer.skip() }
            .disabled(timer.state == .idle || timer.state == .waiting)
        Button("Stop") { timer.stop() }
            .disabled(!timer.isActive)
        Divider()
        Menu("Start Routine") {
            ForEach(model.stats.config.allRoutines) { routine in
                Button(routine.name) { model.startTimer(routine) }
            }
        }
        Divider()
        Button("Show in Stats") { model.showStats() }
        SettingsLink { Text("Edit Routines…") }
    }
}

/* ---------------- words for the clock ---------------- */

enum TimerText {
    /// What the clock shows: time left on a segment with a clock, time so far on one
    /// without, and the length of the segment a routine is waiting to start.
    static func clock(_ timer: WritingTimer, segment: TimerSegment, at now: Date) -> String {
        if timer.state == .waiting { return segment.duration.map { StatsFormat.clock($0) } ?? "0:00" }
        return StatsFormat.clock(timer.remaining(at: now) ?? timer.elapsed(at: now))
    }

    static func words(_ words: Int, goal: Int?) -> String {
        guard let goal else { return "\(words.formatted()) word\(words == 1 ? "" : "s") this sprint" }
        return "\(words.formatted()) of \(goal.formatted()) words"
    }

    /// "8 segments, 2h 0m" — what a routine is, before it runs.
    static func plan(_ routine: WritingRoutine) -> String {
        let count = "\(routine.segments.count) segment\(routine.segments.count == 1 ? "" : "s")"
        if let total = routine.plannedDuration { return "\(count), \(StatsFormat.duration(total))" }
        if routine.repeats == 0 { return "\(count), repeating" }
        if routine.segments.count == 1, let goal = routine.segments[0].wordGoal { return "Until \(goal.formatted()) words" }
        return "\(count), until you stop"
    }
}
