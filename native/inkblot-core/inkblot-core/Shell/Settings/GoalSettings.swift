import SwiftUI

/// Settings ▸ Goals: what each day asks for, the days that differ, how a streak is
/// kept, and the projects' deadlines.
struct GoalSettings: View {
    @Environment(AppModel.self) private var model
    @State private var editing: Int?
    @State private var newOverrideDay = Date()

    var body: some View {
        let calendar = Calendar.current
        let plan = model.stats.config.goals
        Form {
            Section {
                Picker("Count writing in", selection: binding(\.goals.project)) {
                    Text("All projects").tag(String?.none)
                    ForEach(projects, id: \.self) { Text($0).tag(String?.some($0)) }
                }
            } footer: {
                Text("Goals, the streak and the heatmap count the writing in this scope.")
            }

            Section {
                ForEach(calendar.orderedWeekdays, id: \.self) { weekday in
                    DisclosureGroup(isExpanded: Binding(
                        get: { editing == weekday },
                        set: { editing = $0 ? weekday : nil })
                    ) {
                        DayGoalEditor(goal: binding(\.goals.weekly[weekday - 1]))
                    } label: {
                        LabeledContent(calendar.weekdayName(weekday), value: plan.weekly[weekday - 1].summary)
                    }
                }
                Menu("Apply to Every Day") {
                    ForEach(calendar.orderedWeekdays, id: \.self) { weekday in
                        Button("Copy \(calendar.weekdayName(weekday))") {
                            let goal = model.stats.config.goals.weekly[weekday - 1]
                            for day in 0..<7 {
                                var copy = goal
                                copy.targets = goal.targets.map { GoalTarget(metric: $0.metric, amount: $0.amount) }
                                model.stats.config.goals.weekly[day] = copy
                            }
                            model.saveStatsConfig()
                        }
                    }
                }
                .fixedSize()
            } header: {
                Text("Each Week")
            } footer: {
                Text("A day can ask for several things — all of them, or any one. A rest day neither counts toward a streak nor breaks it.")
            }

            Section {
                ForEach(plan.overrides.sorted { $0.day < $1.day }) { override in
                    if let index = model.stats.config.goals.overrides.firstIndex(where: { $0.id == override.id }) {
                        DisclosureGroup {
                            DayGoalEditor(goal: binding(\.goals.overrides[index].goal))
                            Button("Remove This Day", role: .destructive) {
                                model.stats.config.goals.overrides.removeAll { $0.id == override.id }
                                model.saveStatsConfig()
                            }
                        } label: {
                            LabeledContent(
                                StatsDay.date(override.day)?.formatted(date: .complete, time: .omitted) ?? override.day,
                                value: override.goal.summary)
                        }
                    }
                }
                HStack {
                    DatePicker("Day", selection: $newOverrideDay, displayedComponents: .date)
                    Button("Add Day") {
                        let day = StatsDay.key(newOverrideDay)
                        guard !model.stats.config.goals.overrides.contains(where: { $0.day == day }) else { return }
                        let base = model.stats.config.goals.goal(for: day)
                        model.stats.config.goals.overrides.append(GoalOverride(day: day, goal: base))
                        model.saveStatsConfig()
                    }
                }
            } header: {
                Text("Particular Days")
            } footer: {
                Text("A day here asks for its own goal instead of its weekday’s — a holiday off, a push before a deadline.")
            }

            Section {
                Stepper(value: binding(\.streakFreezesPerMonth), in: 0...10) {
                    LabeledContent("Freezes a month", value: model.stats.config.streakFreezesPerMonth == 0
                                   ? "None" : "\(model.stats.config.streakFreezesPerMonth)")
                }
                Toggle("Celebrate when the day’s goal is met", isOn: binding(\.celebrateGoals))
                Stepper(value: binding(\.flowMinutes), in: 5...90, step: 5) {
                    LabeledContent("Flow is typing for", value: "\(model.stats.config.flowMinutes) min in a row")
                }
            } header: {
                Text("Streaks and Flow")
            } footer: {
                Text("A freeze covers a missed day so the streak goes on. Freezes are used as days are missed, and renew each month.")
            }

            DeadlineSettings(projects: projects)
        }
        .formStyle(.grouped)
    }

    private var projects: [String] { model.core.core.listProjects() }

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

/// One day's goal: its targets, all or any, or a rest day.
struct DayGoalEditor: View {
    @Binding var goal: DayGoal

    var body: some View {
        Toggle("Rest day", isOn: $goal.rest)
        if !goal.rest {
            ForEach($goal.targets) { $target in
                HStack {
                    Picker("Measure", selection: $target.metric) {
                        ForEach(GoalMetric.allCases) { Label($0.title, systemImage: $0.symbol).tag($0) }
                    }
                    .labelsHidden()
                    .fixedSize()
                    TextField("Amount", value: $target.amount, format: .number)
                        .frame(width: 70)
                        .multilineTextAlignment(.trailing)
                    Text(target.metric.unit).foregroundStyle(.secondary)
                    Spacer()
                    Button("Remove", systemImage: "minus.circle") {
                        goal.targets.removeAll { $0.id == target.id }
                    }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.borderless)
                }
            }
            HStack {
                Menu("Add Target") {
                    ForEach(GoalMetric.allCases) { metric in
                        Button(metric.title) { goal.targets.append(GoalTarget(metric: metric, amount: metric.defaultAmount)) }
                    }
                }
                .fixedSize()
                Spacer()
                if goal.targets.count > 1 {
                    Picker("Needs", selection: $goal.requireAll) {
                        Text("All of them").tag(true)
                        Text("Any one").tag(false)
                    }
                    .labelsHidden()
                    .fixedSize()
                }
            }
        }
    }
}

/// A word count to reach by a date, per project.
private struct DeadlineSettings: View {
    @Environment(AppModel.self) private var model
    let projects: [String]

    var body: some View {
        Section {
            ForEach(model.stats.config.deadlines) { deadline in
                if let index = model.stats.config.deadlines.firstIndex(where: { $0.id == deadline.id }) {
                    DisclosureGroup {
                        DeadlineEditor(deadline: binding(index), projects: projects)
                        Button("Remove Deadline", role: .destructive) {
                            model.stats.config.deadlines.removeAll { $0.id == deadline.id }
                            model.saveStatsConfig()
                        }
                    } label: {
                        LabeledContent(deadline.project,
                                       value: "\(deadline.targetWords.formatted()) words by \(StatsDay.date(deadline.due)?.formatted(date: .abbreviated, time: .omitted) ?? deadline.due)")
                    }
                }
            }
            Button("Add Deadline", systemImage: "calendar.badge.plus") {
                let today = Date()
                let due = Calendar.current.date(byAdding: .month, value: 3, to: today) ?? today
                let project = model.stats.project ?? projects.first ?? ""
                model.stats.config.deadlines.append(Deadline(
                    project: project, targetWords: 80_000, due: StatsDay.key(due), created: StatsDay.key(today)))
                model.saveStatsConfig()
            }
            .disabled(projects.isEmpty)
        } header: {
            Text("Deadlines")
        } footer: {
            Text("Inkblot works out each writing day’s share from the words left and the days left, and when you’ll finish at your recent pace.")
        }
    }

    private func binding(_ index: Int) -> Binding<Deadline> {
        Binding(
            get: { model.stats.config.deadlines.indices.contains(index) ? model.stats.config.deadlines[index] : Deadline(project: "", targetWords: 0, due: "", created: "") },
            set: { value in
                guard model.stats.config.deadlines.indices.contains(index),
                      model.stats.config.deadlines[index] != value else { return }
                model.stats.config.deadlines[index] = value
                model.saveStatsConfig()
            })
    }
}

private struct DeadlineEditor: View {
    @Binding var deadline: Deadline
    let projects: [String]

    var body: some View {
        let calendar = Calendar.current
        Picker("Project", selection: $deadline.project) {
            ForEach(Set(projects + [deadline.project]).sorted(), id: \.self) { Text($0).tag($0) }
        }
        TextField("Words", value: $deadline.targetWords, format: .number)
        DatePicker("Due", selection: Binding(
            get: { StatsDay.date(deadline.due) ?? Date() },
            set: { deadline.due = StatsDay.key($0) }), displayedComponents: .date)
        LabeledContent("Writing days") {
            WeekdayToggles(selection: $deadline.writingDays, calendar: calendar)
        }
        Toggle("Show the day’s share on the Today page", isOn: $deadline.feedsDailyGoal)
    }
}

/// A button per weekday, on or off.
struct WeekdayToggles: View {
    @Binding var selection: Set<Int>
    let calendar: Calendar

    var body: some View {
        HStack(spacing: 3) {
            ForEach(calendar.orderedWeekdays, id: \.self) { weekday in
                let on = selection.contains(weekday)
                Button(calendar.veryShortWeekdaySymbols[weekday - 1]) {
                    if on, selection.count > 1 { selection.remove(weekday) } else { selection.insert(weekday) }
                }
                .buttonStyle(.bordered)
                .tint(on ? .accentColor : nil)
                .controlSize(.small)
                .accessibilityLabel(calendar.weekdayName(weekday))
                .accessibilityValue(on ? "on" : "off")
            }
        }
    }
}
