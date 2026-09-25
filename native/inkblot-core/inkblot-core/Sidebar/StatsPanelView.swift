import Charts
import SwiftUI

/// The inspector's Stats tab: how the writing is going, for this document, this
/// project, or everything.
///
/// Every figure comes from the core's session store, plus the part of the live session
/// the store has not been sent yet (`StatsTracker.pending`), so the numbers move while
/// the writer types rather than once a minute. The store is read again whenever the
/// tracker records (`revision`), the scope changes, or the chart's range does.
struct StatsPanelView: View {
    @Environment(AppModel.self) private var model
    @AppStorage("inkblot.stats.scope") private var scopeRaw = StatsPanelScope.document.rawValue
    @AppStorage("inkblot.stats.range") private var rangeDays = 30
    @AppStorage("inkblot.stats.metric") private var metricRaw = StatsMetric.words.rawValue
    @AppStorage("inkblot.stats.page") private var pageRaw = StatsPage.today.rawValue
    @State private var snapshot: StatsSnapshot?
    @State private var selectedDay: String?

    private var chosenScope: StatsPanelScope { StatsPanelScope(rawValue: scopeRaw) ?? .document }
    private var metric: StatsMetric { StatsMetric(rawValue: metricRaw) ?? .words }
    private var page: StatsPage { StatsPage(rawValue: pageRaw) ?? .today }

    /// The scope as the store takes it. Falls back when the chosen one has nothing to
    /// name: no document open, or no project.
    private var scope: StatsPanelScope {
        switch chosenScope {
        case .document where model.stats.docPath == nil: model.stats.project == nil ? .all : .project
        case .project where model.stats.project == nil: .all
        default: chosenScope
        }
    }

    private var storeScope: StatsScope {
        switch scope {
        case .all: StatsScope(project: nil, docPath: nil)
        case .project: StatsScope(project: model.stats.project, docPath: nil)
        case .document: StatsScope(project: model.stats.project, docPath: model.stats.docPath)
        }
    }

    var body: some View {
        let stats = model.stats
        Form {
            Section {
                HStack(spacing: 8) {
                    SegmentedTextPicker(
                        options: StatsPage.allCases,
                        selection: Binding(get: { page }, set: { pageRaw = $0.rawValue }),
                        title: \.title)
                        .accessibilityLabel("Page")
                    // Goals, timers and reminders are all set there, so it is one click
                    // from the top rather than a scroll to the bottom.
                    SettingsLink {
                        Image(systemName: "gearshape")
                    }
                    .buttonStyle(.borderless)
                    .help("Stats Settings")
                    .accessibilityLabel("Stats Settings")
                }
                SegmentedTextPicker(
                    options: StatsPanelScope.allCases,
                    selection: Binding(get: { chosenScope }, set: { scopeRaw = $0.rawValue }),
                    title: \.title)
                    .accessibilityLabel("Scope")
            } footer: {
                Text(scopeCaption)
            }

            switch page {
            case .today:
                TimerSection()
                GoalsSection()
                DeadlinesSection(project: model.stats.project)
                nowSection(stats)
                if let snapshot { todaySection(snapshot) }
            case .history:
                StreakSection()
                if let snapshot {
                    activitySection(snapshot)
                    totalsSection(snapshot)
                }
            case .insights:
                InsightsSections(scope: storeScope)
                DeadlinesSection(project: scope == .all ? nil : model.stats.project)
            }

        }
        .formStyle(.grouped)
        .task(id: LoadKey(scope: storeScope, revision: stats.revision, rangeDays: rangeDays)) {
            snapshot = await StatsSnapshot.load(
                model.statsService, scope: storeScope, kind: scope, rangeDays: rangeDays)
        }
    }

    private var scopeCaption: String {
        switch scope {
        case .document: model.stats.docPath.map { "This document: \(docDisplayName(path: $0))" } ?? ""
        case .project: model.stats.project.map { "The \($0) project" } ?? ""
        case .all: "Everything written in Inkblot on this Mac"
        }
    }

    /// The live session's unrecorded work, when it falls inside the scope.
    private var pending: StatsTracker.Pending {
        let stats = model.stats
        guard let session = stats.session else { return .init() }
        switch scope {
        case .all: return stats.pending
        case .project: return session.project == stats.project ? stats.pending : .init()
        case .document: return session.docPath == stats.docPath && session.project == stats.project ? stats.pending : .init()
        }
    }

    /* ---------------- sections ---------------- */

    @ViewBuilder
    private func nowSection(_ stats: StatsTracker) -> some View {
        Section("This Session") {
            if let session = stats.session {
                let written = session.written(countingPastes: stats.config.countPastedWords)
                row("Time open", StatsFormat.clock(session.open))
                row("Time typing", StatsFormat.clock(session.active),
                    help: "Edits less than \(Int(stats.config.activeGap)) seconds apart count as typing.")
                row("Words written", written.formatted())
                row("Words deleted", session.wordsDeleted.formatted())
                if session.wordsPasted > 0 { row("Words pasted", session.wordsPasted.formatted()) }
                row("Pace", StatsFormat.pace(words: written, activeSecs: session.active),
                    help: "Words written per minute of typing.")
            } else {
                Text("Start typing to begin a session.")
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private func todaySection(_ snapshot: StatsSnapshot) -> some View {
        let countPastes = model.stats.config.countPastedWords
        let today = snapshot.today
        let written = (today.map { $0.written(countingPastes: countPastes) } ?? 0) + pending.written
        let active = Double(today?.activeSecs ?? 0) + pending.active
        let open = Double(today?.openSecs ?? 0) + pending.open
        let average = snapshot.averageWrittenPerDay(countingPastes: countPastes)
        Section("Today") {
            row("Words written", written.formatted(),
                detail: average > 0 ? "\(average.formatted()) a day on average" : nil)
            row("Words deleted", ((today.map { Int($0.wordsDeleted) } ?? 0) + pending.deleted).formatted())
            row("Time typing", StatsFormat.duration(active))
            row("Time open", StatsFormat.duration(open))
        }
    }

    @ViewBuilder
    private func totalsSection(_ snapshot: StatsSnapshot) -> some View {
        let totals = snapshot.totals
        let countPastes = model.stats.config.countPastedWords
        let written = Int(totals.wordsAdded) + (countPastes ? Int(totals.wordsPasted) : 0) + pending.written
        let active = Double(totals.activeSecs) + pending.active
        Section("All Time") {
            if let length = liveLength ?? snapshot.length {
                row(scope == .document ? "Length" : "Project length",
                    "\(length.words.formatted()) words",
                    detail: "\(length.chars.formatted()) characters")
            }
            row("Words written", written.formatted())
            row("Words deleted", (Int(totals.wordsDeleted) + pending.deleted).formatted())
            if totals.wordsPasted > 0 { row("Words pasted", totals.wordsPasted.formatted()) }
            row("Time typing", StatsFormat.duration(active))
            row("Time open", StatsFormat.duration(Double(totals.openSecs) + pending.open))
            row("Average pace", StatsFormat.pace(words: written, activeSecs: active),
                help: "Words written per minute of typing, over every session.")
            row("Sessions", totals.sessions.formatted(),
                detail: totals.sessions > 0 ? "\(StatsFormat.duration(Double(totals.openSecs) / Double(totals.sessions))) on average" : nil)
            if totals.longestSessionSecs > 0 {
                row("Longest session", StatsFormat.duration(Double(totals.longestSessionSecs)))
            }
            row("Days written", totals.daysWritten.formatted())
            sprintRows(snapshot.runs)
            if let first = totals.firstSession {
                row("Since", Date(timeIntervalSince1970: first / 1000).formatted(date: .abbreviated, time: .omitted))
            }
        }
    }

    /// What the writing timer has added up to. Nothing until it has been used.
    @ViewBuilder
    private func sprintRows(_ runs: [TimerRun]) -> some View {
        if !runs.isEmpty {
            let finished = runs.filter { $0.completed == true }.count
            let sprints = runs.map { Int($0.sprintsCompleted ?? 0) }.reduce(0, +)
            let skipped = runs.map { Int($0.sprintsSkipped ?? 0) }.reduce(0, +)
            let words = runs.map { Int($0.wordsWritten ?? 0) }.reduce(0, +)
            row("Timer runs", runs.count.formatted(),
                detail: "\(finished.formatted()) finished", help: scope == .document ? "Timer runs in this document’s project." : nil)
            row("Sprints finished", sprints.formatted(),
                detail: skipped > 0 ? "\(skipped.formatted()) skipped" : nil)
            if sprints + skipped > 0 {
                row("Words per sprint", (words / (sprints + skipped)).formatted(),
                    help: "Words written in the timer’s writing segments, finished or skipped, per segment.")
            }
        }
    }

    /// The open document's length as the page last counted it — for a document the
    /// store has never seen a session of.
    private var liveLength: (words: Int, chars: Int)? {
        guard scope == .document, let changed = model.bridge.lastDocChanged,
              changed.docPath == model.stats.docPath else { return nil }
        return (Int(changed.wordCount), Int(changed.charCount))
    }

    @ViewBuilder
    private func activitySection(_ snapshot: StatsSnapshot) -> some View {
        Section {
            HStack {
                Picker("Show", selection: $metricRaw) {
                    ForEach(StatsMetric.allCases) { Text($0.title).tag($0.rawValue) }
                }
                .labelsHidden()
                .fixedSize()
                Spacer()
                Picker("Range", selection: $rangeDays) {
                    Text("7 days").tag(7)
                    Text("30 days").tag(30)
                    Text("90 days").tag(90)
                }
                .labelsHidden()
                .fixedSize()
            }
            ActivityChart(
                days: snapshot.series(countingPastes: model.stats.config.countPastedWords),
                metric: metric,
                selectedDay: $selectedDay)
                .frame(height: 150)
        } header: {
            Text("Activity")
        }
    }

    /* ---------------- rows ---------------- */

    /// A labelled figure, hidden while the search bar filters for something it does not
    /// mention — the "This Panel" scope every panel answers.
    @ViewBuilder
    private func row(_ label: String, _ value: String, detail: String? = nil, help: String? = nil) -> some View {
        let query = model.sidebar.scope == .panel ? model.sidebar.query.trimmingCharacters(in: .whitespaces) : ""
        if query.isEmpty || label.localizedCaseInsensitiveContains(query) {
            LabeledContent(label) {
                VStack(alignment: .trailing, spacing: 1) {
                    Text(value).monospacedDigit()
                    if let detail {
                        Text(detail).font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            .help(help ?? "")
        }
    }

    private struct LoadKey: Equatable {
        let scope: StatsScope
        let revision: Int
        let rangeDays: Int
    }
}

/* ---------------- the chart ---------------- */

/// One measure a day, on one axis. Words shows two series — written above the
/// baseline in the accent, deleted below it in grey — so the legend names them; the
/// others are one series the picker names.
private struct ActivityChart: View {
    let days: [StatsSnapshot.Day]
    let metric: StatsMetric
    @Binding var selectedDay: String?

    var body: some View {
        Chart {
            ForEach(days) { day in
                switch metric {
                case .words:
                    BarMark(x: .value("Day", day.date, unit: .day), y: .value("Words", day.written))
                        .foregroundStyle(by: .value("Series", "Written"))
                        .cornerRadius(4)
                    BarMark(x: .value("Day", day.date, unit: .day), y: .value("Words", -day.deleted))
                        .foregroundStyle(by: .value("Series", "Deleted"))
                        .cornerRadius(4)
                case .typing:
                    BarMark(x: .value("Day", day.date, unit: .day), y: .value("Minutes", day.activeSecs / 60))
                        .foregroundStyle(Color.accentColor)
                        .cornerRadius(4)
                case .open:
                    BarMark(x: .value("Day", day.date, unit: .day), y: .value("Minutes", day.openSecs / 60))
                        .foregroundStyle(Color.accentColor)
                        .cornerRadius(4)
                }
            }
            if let selected = days.first(where: { $0.id == selectedDay }) {
                RuleMark(x: .value("Day", selected.date, unit: .day))
                    .foregroundStyle(.secondary.opacity(0.4))
                    .lineStyle(StrokeStyle(lineWidth: 1))
                    .annotation(position: .top, overflowResolution: .init(x: .fit, y: .disabled)) {
                        tooltip(selected)
                    }
            }
        }
        .chartForegroundStyleScale(["Written": Color.accentColor, "Deleted": Color.gray.opacity(0.55)])
        .chartLegend(metric == .words ? .visible : .hidden)
        .chartYAxis {
            AxisMarks(position: .leading) { value in
                AxisGridLine().foregroundStyle(.quaternary)
                AxisValueLabel {
                    if let number = value.as(Double.self) {
                        Text(metric == .words ? abs(number).formatted(.number.notation(.compactName)) : "\(Int(number))m")
                    }
                }
            }
        }
        .chartXAxis {
            AxisMarks(values: .automatic(desiredCount: 4)) { _ in
                AxisValueLabel(format: .dateTime.month(.abbreviated).day())
            }
        }
        .chartXSelection(value: Binding(
            get: { days.first(where: { $0.id == selectedDay })?.date },
            set: { date in selectedDay = date.map { StatsDay.key($0) } }))
        .overlay {
            if days.allSatisfy(\.isEmpty) {
                Text("Nothing written in this range yet.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func tooltip(_ day: StatsSnapshot.Day) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(day.date.formatted(date: .abbreviated, time: .omitted)).font(.caption.weight(.semibold))
            switch metric {
            case .words:
                Text("\(day.written.formatted()) written").font(.caption)
                Text("\(day.deleted.formatted()) deleted").font(.caption).foregroundStyle(.secondary)
            case .typing:
                Text("\(StatsFormat.duration(day.activeSecs)) typing").font(.caption)
            case .open:
                Text("\(StatsFormat.duration(day.openSecs)) open").font(.caption)
            }
        }
        .padding(6)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 6))
    }
}

/* ---------------- what the panel reads ---------------- */

/// The Stats tab's three pages: the day in hand, what has been, and what it shows.
enum StatsPage: String, CaseIterable, Identifiable {
    case today, history, insights
    var id: String { rawValue }
    var title: String {
        switch self {
        case .today: "Today"
        case .history: "History"
        case .insights: "Insights"
        }
    }
}

enum StatsPanelScope: String, CaseIterable, Identifiable {
    case document, project, all
    var id: String { rawValue }
    var title: String {
        switch self {
        case .document: "Document"
        case .project: "Project"
        case .all: "All"
        }
    }
}

enum StatsMetric: String, CaseIterable, Identifiable {
    case words, typing, open
    var id: String { rawValue }
    var title: String {
        switch self {
        case .words: "Words"
        case .typing: "Time Typing"
        case .open: "Time Open"
        }
    }
}

/// One read of the store for the panel: the range's days, all-time totals, and the
/// length of what is in scope.
struct StatsSnapshot {
    struct Day: Identifiable {
        let id: String
        let date: Date
        let written: Int
        let deleted: Int
        let activeSecs: Double
        let openSecs: Double
        var isEmpty: Bool { written == 0 && deleted == 0 && activeSecs == 0 && openSecs == 0 }
    }

    let fromDay: String
    let todayKey: String
    let days: [DayStat]
    let totals: StatsTotals
    let length: (words: Int, chars: Int)?
    /// Timer runs in the project, or everywhere. A run is not a document's: it can
    /// cross several, so the Document scope shows its project's.
    let runs: [TimerRun]

    var today: DayStat? { days.first { $0.day == todayKey } }

    /// Words a day over the range's days with any writing, today excluded — today is
    /// not over.
    func averageWrittenPerDay(countingPastes: Bool) -> Int {
        let past = days.filter { $0.day != todayKey && $0.written(countingPastes: countingPastes) > 0 }
        guard !past.isEmpty else { return 0 }
        return past.map { $0.written(countingPastes: countingPastes) }.reduce(0, +) / past.count
    }

    /// Every day of the range, empty ones included, so the bars keep their places.
    func series(countingPastes: Bool, calendar: Calendar = .current) -> [Day] {
        guard let start = StatsDay.date(fromDay, calendar: calendar),
              let end = StatsDay.date(todayKey, calendar: calendar) else { return [] }
        let byDay = Dictionary(days.map { ($0.day, $0) }, uniquingKeysWith: { $1 })
        var result: [Day] = []
        var date = start
        while date <= end {
            let key = StatsDay.key(date, calendar: calendar)
            let stat = byDay[key]
            result.append(Day(
                id: key, date: date,
                written: stat?.written(countingPastes: countingPastes) ?? 0,
                deleted: Int(stat?.wordsDeleted ?? 0),
                activeSecs: Double(stat?.activeSecs ?? 0),
                openSecs: Double(stat?.openSecs ?? 0)))
            guard let next = calendar.date(byAdding: .day, value: 1, to: date) else { break }
            date = next
        }
        return result
    }

    static func load(
        _ service: StatsService, scope: StatsScope, kind: StatsPanelScope, rangeDays: Int,
        now: Date = Date(), calendar: Calendar = .current
    ) async -> StatsSnapshot {
        let today = calendar.startOfDay(for: now)
        let from = calendar.date(byAdding: .day, value: -(rangeDays - 1), to: today) ?? today
        let (fromKey, todayKey) = (StatsDay.key(from, calendar: calendar), StatsDay.key(today, calendar: calendar))

        async let days = service.daily(scope, from: fromKey, to: todayKey)
        async let totals = service.totals(scope)
        async let runs = service.timerRuns(project: kind == .all ? nil : scope.project)
        var length: (Int, Int)?
        if kind != .all, let project = scope.project {
            let counts = await service.projectWordCounts(project)
            if kind == .document {
                length = scope.docPath.flatMap { counts[$0] }.map { (Int($0.words), Int($0.chars)) }
            } else {
                length = counts.values.reduce((0, 0)) { ($0.0 + Int($1.words), $0.1 + Int($1.chars)) }
            }
        }
        return await StatsSnapshot(
            fromDay: fromKey, todayKey: todayKey, days: days, totals: totals, length: length, runs: runs)
    }
}

extension DayStat {
    func written(countingPastes: Bool) -> Int {
        Int(wordsAdded) + (countingPastes ? Int(wordsPasted) : 0)
    }
}

extension StatsScope: Hashable {
    public func hash(into hasher: inout Hasher) {
        hasher.combine(project)
        hasher.combine(docPath)
    }
}

/// How the panel writes times and rates.
enum StatsFormat {
    /// `1h 05m`, `12m`, `40s`.
    static func duration(_ seconds: Double) -> String {
        let total = Int(seconds.rounded())
        let (hours, minutes) = (total / 3600, (total % 3600) / 60)
        if hours > 0 { return String(format: "%dh %02dm", hours, minutes) }
        if minutes > 0 { return "\(minutes)m" }
        return "\(total)s"
    }

    /// `1:02:05`, `4:12` — a running clock.
    static func clock(_ seconds: Double) -> String {
        let total = Int(seconds)
        let (hours, minutes, secs) = (total / 3600, (total % 3600) / 60, total % 60)
        return hours > 0 ? String(format: "%d:%02d:%02d", hours, minutes, secs) : String(format: "%d:%02d", minutes, secs)
    }

    /// Words per minute of typing, or a dash before there is a minute to divide by.
    static func pace(words: Int, activeSecs: Double) -> String {
        guard activeSecs >= 30 else { return "—" }
        return "\(Int((Double(words) / (activeSecs / 60)).rounded()).formatted()) wpm"
    }
}
