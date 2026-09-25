import Charts
import SwiftUI

/* ============================================================
   Today's goal
   ============================================================ */

/// Today against the goal plan: a ring per target, the streak beside them.
struct GoalsSection: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let goals = model.goals
        let status = goals.status
        let streak = goals.streak
        Section {
            if goals.todayGoal.rest {
                Label("Rest day. Nothing is asked of today.", systemImage: "moon.zzz")
                    .foregroundStyle(.secondary)
            } else if status.targets.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("No goal for today.")
                    SettingsLink { Text("Set Goals…") }
                        .buttonStyle(.link)
                }
                .foregroundStyle(.secondary)
            } else {
                GoalRings(status: status)
                if let remaining = status.remainingText {
                    Text(remaining.prefix(1).uppercased() + remaining.dropFirst() + ".")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
            }
            StreakRow(streak: streak)
        } header: {
            HStack {
                Text("Today’s Goal")
                Spacer()
                if status.met == true {
                    Label("Met", systemImage: "checkmark.seal.fill")
                        .labelStyle(.titleAndIcon)
                        .foregroundStyle(Color.accentColor)
                        .symbolEffect(.bounce, value: goals.metJustNow)
                }
            }
        } footer: {
            Text(goals.plan.project.map { "Counting writing in \($0)." } ?? "Counting all your writing.")
        }
    }
}

/// A ring per target: how far, and the figures under it.
struct GoalRings: View {
    let status: GoalStatus

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            ForEach(status.targets) { target in
                VStack(spacing: 6) {
                    ZStack {
                        Circle().stroke(.quaternary, lineWidth: 6)
                        Circle()
                            .trim(from: 0, to: target.fraction)
                            .stroke(Color.accentColor, style: StrokeStyle(lineWidth: 6, lineCap: .round))
                            .rotationEffect(.degrees(-90))
                            .animation(.smooth, value: target.fraction)
                        Image(systemName: target.met ? "checkmark" : target.target.metric.symbol)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(target.met ? Color.accentColor : .secondary)
                            .contentTransition(.symbolEffect(.replace))
                    }
                    .frame(width: 48, height: 48)
                    VStack(spacing: 0) {
                        Text("\(Int(target.value.rounded(.down)).formatted()) / \(target.target.amount.formatted())")
                            .font(.caption.weight(.semibold))
                            .monospacedDigit()
                        Text(target.target.metric.title)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: .infinity)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(target.target.metric.title): \(Int(target.value)) of \(target.target.amount) \(target.target.metric.unit)")
            }
        }
        .padding(.vertical, 4)
    }
}

struct StreakRow: View {
    let streak: StreakSummary

    var body: some View {
        LabeledContent {
            VStack(alignment: .trailing, spacing: 1) {
                Text(streak.current == 1 ? "1 day" : "\(streak.current.formatted()) days").monospacedDigit()
                Text(detail).font(.caption).foregroundStyle(.secondary)
            }
        } label: {
            Label("Streak", systemImage: streak.todayCounts ? "flame.fill" : "flame")
                .foregroundStyle(streak.todayCounts ? Color.accentColor : .primary)
        }
    }

    private var detail: String {
        var parts = ["best \(streak.best.formatted())"]
        if streak.freezesAllowed > 0 {
            let left = max(0, streak.freezesAllowed - streak.freezesUsed)
            parts.append("\(left) freeze\(left == 1 ? "" : "s") left this month")
        }
        if !streak.todayCounts, streak.current > 0 { parts.insert("today not yet", at: 0) }
        return parts.joined(separator: " · ")
    }
}

/* ============================================================
   The heatmap
   ============================================================ */

/// A calendar of days, a column per week: shaded by words written, or by whether the
/// day's goal was met. Hovering a day names it.
struct StreakHeatmap: View {
    enum Shading: String, CaseIterable, Identifiable {
        case words, goals
        var id: String { rawValue }
        var title: String { self == .words ? "Words" : "Goals" }
    }

    let history: [String: DayProgress]
    let plan: GoalPlan
    let today: String
    let weeks: Int
    let shading: Shading
    @State private var hovered: String?
    @State private var width: CGFloat = 280

    private let calendar = Calendar.current
    private let gap: CGFloat = 2

    var body: some View {
        let days = columns()
        let levels = wordLevels()
        VStack(alignment: .leading, spacing: 6) {
            let size = cellSize
            Canvas { context, _ in
                for (column, week) in days.enumerated() {
                    for (row, day) in week.enumerated() {
                        guard let day else { continue }
                        let rect = CGRect(x: CGFloat(column) * (size + gap), y: CGFloat(row) * (size + gap), width: size, height: size)
                        let path = Path(roundedRect: rect, cornerRadius: min(2, size / 4))
                        let fill = color(for: day, levels: levels)
                        context.fill(path, with: .color(fill.color))
                        if fill.outlined { context.stroke(path, with: .color(.secondary.opacity(0.5)), lineWidth: 1) }
                        if day == hovered { context.stroke(path, with: .color(.primary), lineWidth: 1.5) }
                    }
                }
            }
            // Square cells whatever the width: the height follows from it.
            .aspectRatio(CGFloat(weeks) / 7, contentMode: .fit)
            .onGeometryChange(for: CGFloat.self, of: { $0.size.width }) { width = $0 }
            .onContinuousHover { phase in
                switch phase {
                case .active(let point):
                    let column = Int(point.x / (size + gap)), row = Int(point.y / (size + gap))
                    hovered = days.indices.contains(column) && (0..<7).contains(row) ? days[column][row] : nil
                case .ended:
                    hovered = nil
                }
            }
            Text(caption)
                .font(.caption)
                .foregroundStyle(.secondary)
                .monospacedDigit()
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Writing calendar, \(weeks) weeks")
    }

    private var cellSize: CGFloat {
        max(3, (width - gap * CGFloat(weeks - 1)) / CGFloat(weeks))
    }

    private var caption: String {
        guard let hovered, let date = StatsDay.date(hovered) else {
            return shading == .words ? "Darker days, more words." : "Filled: goal met. Pale: some writing. Outlined: rest day."
        }
        let progress = history[hovered] ?? DayProgress()
        var text = "\(date.formatted(date: .abbreviated, time: .omitted)): \(progress.words.formatted()) words"
        if progress.typingSecs > 0 { text += ", \(StatsFormat.duration(progress.typingSecs)) typing" }
        return text
    }

    /// Columns of seven days, oldest week first, ending with the week of today. Days
    /// after today are `nil`.
    private func columns() -> [[String?]] {
        guard let end = StatsDay.date(today, calendar: calendar) else { return [] }
        let weekday = calendar.component(.weekday, from: end)
        let offset = (weekday - calendar.firstWeekday + 7) % 7
        guard let lastWeekStart = calendar.date(byAdding: .day, value: -offset, to: end),
              let start = calendar.date(byAdding: .day, value: -7 * (weeks - 1), to: lastWeekStart) else { return [] }
        return (0..<weeks).map { week in
            (0..<7).map { day in
                guard let date = calendar.date(byAdding: .day, value: week * 7 + day, to: start), date <= end else { return nil }
                return StatsDay.key(date, calendar: calendar)
            }
        }
    }

    /// Quartiles of the days with any words, so the shades spread across this writer's
    /// own range rather than a fixed one.
    private func wordLevels() -> [Int] {
        let counts = history.values.map(\.words).filter { $0 > 0 }.sorted()
        guard !counts.isEmpty else { return [] }
        return [0.25, 0.5, 0.75].map { counts[min(counts.count - 1, Int(Double(counts.count) * $0))] }
    }

    private func color(for day: String, levels: [Int]) -> (color: Color, outlined: Bool) {
        let progress = history[day] ?? DayProgress()
        let empty = Color.secondary.opacity(0.15)
        switch shading {
        case .words:
            guard progress.words > 0 else { return (empty, false) }
            let level = levels.filter { progress.words > $0 }.count
            return (Color.accentColor.opacity([0.3, 0.5, 0.75, 1][level]), false)
        case .goals:
            let goal = plan.goal(for: day, calendar: calendar)
            if goal.rest { return (.clear, true) }
            switch StreakCalculator.classify(day, progress: progress, plan: plan, calendar: calendar) {
            case .counts: return (Color.accentColor, false)
            case .skipped, .missed:
                return progress.words > 0 ? (Color.accentColor.opacity(0.3), false) : (empty, false)
            }
        }
    }
}

/// The History page's streak: the figures and the calendar.
struct StreakSection: View {
    @Environment(AppModel.self) private var model
    @AppStorage("inkblot.stats.heatmapWeeks") private var weeks = 26
    @AppStorage("inkblot.stats.heatmapShading") private var shadingRaw = StreakHeatmap.Shading.words.rawValue

    var body: some View {
        let goals = model.goals
        var history = goals.history
        history[goals.todayKey] = goals.today
        return Section {
            StreakRow(streak: goals.streak)
            HStack {
                Picker("Shade by", selection: $shadingRaw) {
                    ForEach(StreakHeatmap.Shading.allCases) { Text($0.title).tag($0.rawValue) }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .fixedSize()
                Spacer()
                Picker("Weeks", selection: $weeks) {
                    Text("3 months").tag(13)
                    Text("6 months").tag(26)
                    Text("1 year").tag(53)
                }
                .labelsHidden()
                .fixedSize()
            }
            StreakHeatmap(
                history: history, plan: goals.plan, today: goals.todayKey, weeks: weeks,
                shading: StreakHeatmap.Shading(rawValue: shadingRaw) ?? .words)
        } header: {
            Text("Streak")
        } footer: {
            Text(goals.plan.project.map { "Writing in \($0), as your goals count it." } ?? "All your writing, as your goals count it.")
        }
    }
}

/* ============================================================
   Deadlines
   ============================================================ */

/// A project's deadline: how far, how fast, today's share, and the burndown.
struct DeadlineCard: View {
    @Environment(AppModel.self) private var model
    let deadline: Deadline
    let status: DeadlineStatus

    var body: some View {
        let netToday = model.goals.netToday(for: deadline)
        let due = StatsDay.date(deadline.due)
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(deadline.project).font(.headline)
                Spacer()
                badge
            }
            ProgressView(value: min(1, Double(status.currentWords) / Double(max(1, deadline.targetWords)))) {
                Text("\(status.currentWords.formatted()) of \(deadline.targetWords.formatted()) words")
                    .font(.callout)
                    .monospacedDigit()
            }
            if let due {
                Text("Due \(due.formatted(date: .abbreviated, time: .omitted)) · \(status.writingDaysLeft) writing day\(status.writingDaysLeft == 1 ? "" : "s") left")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if deadline.feedsDailyGoal, let quota = status.quota, !status.isDone {
                LabeledContent("Today’s share") {
                    Text("\(max(0, netToday).formatted()) / \(quota.formatted()) words").monospacedDigit()
                }
            }
            LabeledContent("Pace") {
                Text(status.pace > 0 ? "\(Int(status.pace.rounded()).formatted()) words a writing day" : "Not enough writing yet")
            }
            if let finish = status.projectedFinish, !status.isDone {
                LabeledContent("At this pace") {
                    Text("done \(finish.formatted(date: .abbreviated, time: .omitted))")
                }
            }
            if status.burndown.count > 1 { burndown }
        }
        .padding(.vertical, 4)
    }

    /// On track, behind, or done — said, not only coloured.
    @ViewBuilder
    private var badge: some View {
        if status.isDone {
            Label("Done", systemImage: "checkmark.seal.fill").foregroundStyle(Color.accentColor)
        } else if status.isOverdue {
            Label("Past due", systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange)
        } else if status.onTrack {
            Label("On track", systemImage: "checkmark.circle").foregroundStyle(.secondary)
        } else {
            Label("Behind", systemImage: "tortoise").foregroundStyle(.orange)
        }
    }

    /// Words left each day since the deadline was set, against the straight line from
    /// then to the due date.
    private var burndown: some View {
        let points = status.burndown
        let ideal: [DeadlineStatus.Point] = {
            guard let first = points.first, let due = StatsDay.date(deadline.due) else { return [] }
            return [first, DeadlineStatus.Point(day: deadline.due, date: due, remaining: 0)]
        }()
        return Chart {
            ForEach(ideal) { point in
                LineMark(x: .value("Day", point.date), y: .value("Words left", point.remaining), series: .value("Line", "Planned"))
                    .foregroundStyle(.secondary)
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
            }
            ForEach(points) { point in
                LineMark(x: .value("Day", point.date), y: .value("Words left", point.remaining), series: .value("Line", "Left"))
                    .foregroundStyle(Color.accentColor)
                    .lineStyle(StrokeStyle(lineWidth: 2))
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading) { value in
                AxisGridLine().foregroundStyle(.quaternary)
                AxisValueLabel { if let n = value.as(Int.self) { Text(n.formatted(.number.notation(.compactName))) } }
            }
        }
        .chartXAxis { AxisMarks(values: .automatic(desiredCount: 3)) { _ in AxisValueLabel(format: .dateTime.month(.abbreviated).day()) } }
        .frame(height: 110)
        .accessibilityLabel("Burndown: words left each day, against the planned line")
    }
}

/// The deadlines for what the panel is showing: this project's, or every one.
struct DeadlinesSection: View {
    @Environment(AppModel.self) private var model
    let project: String?

    var body: some View {
        let deadlines = model.stats.config.deadlines.filter { project == nil || $0.project == project }
        if !deadlines.isEmpty {
            Section("Deadline") {
                ForEach(deadlines) { deadline in
                    if let status = model.goals.deadlineStatus[deadline.id] {
                        DeadlineCard(deadline: deadline, status: status)
                    } else {
                        ProgressView().frame(maxWidth: .infinity)
                    }
                }
            }
        }
    }
}
