import SwiftUI

/// The Insights page: when this writer writes, how, and how this week compares — read
/// from the last ninety days of the panel's scope.
struct InsightsSections: View {
    @Environment(AppModel.self) private var model
    let scope: StatsScope
    @State private var insights: RhythmInsights?

    static let days = 90

    var body: some View {
        Group {
            if let insights {
                weekSection(insights)
                rhythmSection(insights)
                habitsSection(insights)
            } else {
                Section { ProgressView().frame(maxWidth: .infinity) }
            }
        }
        .task(id: LoadKey(scope: scope, revision: model.stats.revision)) { await load() }
    }

    private struct LoadKey: Equatable {
        let scope: StatsScope
        let revision: Int
    }

    private func load() async {
        let calendar = Calendar.current
        let now = Date()
        let today = StatsDay.key(now, calendar: calendar)
        let from = StatsDay.key(calendar.date(byAdding: .day, value: -(Self.days - 1), to: now) ?? now, calendar: calendar)
        async let days = model.statsService.daily(scope, from: from, to: today)
        async let sessions = model.statsService.sessions(scope, from: from, to: today)
        insights = await RhythmInsights.compute(
            days: days, sessions: sessions, today: today, flowMinutes: model.stats.config.flowMinutes,
            countingPastes: model.stats.config.countPastedWords, calendar: calendar)
    }

    /* ---------------- sections ---------------- */

    @ViewBuilder
    private func weekSection(_ insights: RhythmInsights) -> some View {
        Section("This Week") {
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    Text(insights.thisWeekWords.formatted())
                        .font(.system(size: 28, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                    Text("words")
                        .foregroundStyle(.secondary)
                    Spacer()
                    if let change = insights.weekChange {
                        Label(change, systemImage: insights.thisWeekWords >= insights.lastWeekWords ? "arrow.up.right" : "arrow.down.right")
                            .font(.callout.weight(.medium))
                            .foregroundStyle(.secondary)
                            .help("Against the seven days before")
                    }
                }
                Text(weekSentence(insights))
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            .padding(.vertical, 2)
        }
    }

    private func weekSentence(_ insights: RhythmInsights) -> String {
        var parts: [String] = []
        if insights.thisWeekTypingSecs > 0 { parts.append("\(StatsFormat.duration(insights.thisWeekTypingSecs)) of typing over the last seven days") }
        if let hour = insights.bestHour { parts.append("your best hour is \(hourRange(hour))") }
        guard !parts.isEmpty else { return "Nothing written in the last seven days yet." }
        let sentence = parts.joined(separator: ", and ")
        return sentence.prefix(1).uppercased() + sentence.dropFirst() + "."
    }

    @ViewBuilder
    private func rhythmSection(_ insights: RhythmInsights) -> some View {
        Section {
            if let hour = insights.bestHour {
                LabeledContent("Best time", value: hourRange(hour))
            }
            if let weekday = insights.bestWeekday {
                LabeledContent("Best day", value: Calendar.current.weekdayName(weekday))
            }
            HourGrid(grid: insights.grid)
        } header: {
            Text("When You Write")
        } footer: {
            Text("Time typing by hour and weekday, over the last \(Self.days) days.")
        }
    }

    @ViewBuilder
    private func habitsSection(_ insights: RhythmInsights) -> some View {
        Section("How You Write") {
            LabeledContent("Flow sessions") {
                VStack(alignment: .trailing, spacing: 1) {
                    Text(insights.flowSessions.formatted()).monospacedDigit()
                    Text("of \(insights.sessions.formatted()) sessions").font(.caption).foregroundStyle(.secondary)
                }
            }
            .help("Sessions with at least \(model.stats.config.flowMinutes) minutes of typing in a row, each minute mostly typing.")
            LabeledContent("Longest flow", value: insights.longestFlowMinutes == 0 ? "—" : "\(insights.longestFlowMinutes) min")
            if insights.sessions > 0 {
                LabeledContent("Average session", value: StatsFormat.duration(insights.averageSessionSecs))
            }
            LabeledContent("Rewriting") {
                Text(insights.editingRatio > 0 ? "\(Int((insights.editingRatio * 100).rounded())) deleted per 100 written" : "—")
            }
            .help("How much of the writing is taking words out again. Drafting runs low; revising runs high.")
            if insights.pastedShare > 0 {
                LabeledContent("Pasted", value: insights.pastedShare.formatted(.percent.precision(.fractionLength(0))))
            }
        }
    }
}

/// Seven rows of 24 hours, shaded by time typing. Hovering a cell names it.
private struct HourGrid: View {
    let grid: [Int: [Int]]
    @State private var hovered: (weekday: Int, hour: Int)?
    @State private var width: CGFloat = 280

    private let gap: CGFloat = 1.5
    private let labelWidth: CGFloat = 26

    var body: some View {
        let calendar = Calendar.current
        let weekdays = calendar.orderedWeekdays
        let peak = max(1, grid.values.flatMap { $0 }.max() ?? 1)
        let size = max(3, (width - labelWidth - gap * 23) / 24)
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 0) {
                VStack(alignment: .leading, spacing: gap) {
                    ForEach(weekdays, id: \.self) { weekday in
                        Text(calendar.veryShortWeekdaySymbols[weekday - 1])
                            .font(.system(size: 9))
                            .foregroundStyle(.secondary)
                            .frame(width: labelWidth, height: size, alignment: .leading)
                    }
                }
                Canvas { context, _ in
                    for (row, weekday) in weekdays.enumerated() {
                        let hours = grid[weekday] ?? Array(repeating: 0, count: 24)
                        for hour in 0..<24 {
                            let rect = CGRect(x: CGFloat(hour) * (size + gap), y: CGFloat(row) * (size + gap), width: size, height: size)
                            let value = hours.indices.contains(hour) ? hours[hour] : 0
                            let color = value == 0 ? Color.secondary.opacity(0.12) : Color.accentColor.opacity(0.2 + 0.8 * Double(value) / Double(peak))
                            context.fill(Path(roundedRect: rect, cornerRadius: 1.5), with: .color(color))
                            if let hovered, hovered.weekday == weekday, hovered.hour == hour {
                                context.stroke(Path(roundedRect: rect, cornerRadius: 1.5), with: .color(.primary), lineWidth: 1)
                            }
                        }
                    }
                }
                .frame(height: 7 * size + 6 * gap)
                .onContinuousHover { phase in
                    switch phase {
                    case .active(let point):
                        let hour = Int(point.x / (size + gap)), row = Int(point.y / (size + gap))
                        hovered = (0..<24).contains(hour) && weekdays.indices.contains(row) ? (weekdays[row], hour) : nil
                    case .ended:
                        hovered = nil
                    }
                }
            }
            .onGeometryChange(for: CGFloat.self, of: { $0.size.width }) { width = $0 }
            Text(caption(calendar))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Time typing by hour and weekday")
    }

    private func caption(_ calendar: Calendar) -> String {
        guard let hovered else { return "Midnight on the left, the evening on the right." }
        let secs = grid[hovered.weekday].map { $0.indices.contains(hovered.hour) ? $0[hovered.hour] : 0 } ?? 0
        return "\(calendar.weekdayName(hovered.weekday))s, \(hourRange(hovered.hour)): \(StatsFormat.duration(Double(secs))) typing"
    }
}
