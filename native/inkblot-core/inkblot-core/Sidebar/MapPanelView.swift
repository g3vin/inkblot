import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// The inspector's Map panel: the active map's settings, or the one thing on it that is
/// selected.
///
/// The page's map inspector (`MapPanelView.jsx`) made native. The page builds the panel
/// as a form — tabs, sections and typed fields (`MapPanel`) — and publishes it with the
/// map's toolbar (`mapChromeChanged`); this draws that form and sends each edit back as
/// a `mapCommand` naming the field's id. It never learns what a field means, so every
/// figure (a route's length, a leg's arrival, a year's length) is the page's, worked out
/// by the page's maths, and nothing here keeps a copy of the map.
///
/// Fields commit as the page's do: text and numbers on Return, on losing focus, or on
/// going away — a name typed is one undo step — and everything else at once.
struct MapPanelView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        if let state = model.bridge.mapChrome {
            PanelFormView(panel: state.panel, send: MapPanelSender(bridge: model.bridge, surfaceId: state.surfaceId))
        } else {
            ContentUnavailableView(
                "No Map",
                systemImage: "map",
                description: Text("Open a map to edit its places, journeys and look."))
        }
    }
}

/// A panel form the page built (`MapPanel`) — a map's inspector, or a timeline view's,
/// which is built the same way — drawn natively, every edit sent back by id.
struct PanelFormView: View {
    let panel: MapPanel
    let send: MapPanelSender

    var body: some View {
        Form {
            ForEach(panel.sections, id: \.id) { section in
                Section {
                    ForEach(Array(section.fields.enumerated()), id: \.offset) { _, field in
                        MapPanelFieldView(field: field, send: send)
                    }
                } header: {
                    if !section.title.isEmpty || !section.actions.isEmpty {
                        HStack {
                            Text(section.title)
                            Spacer()
                            ForEach(section.actions, id: \.id) { MapPanelButtonView(button: $0, send: send, small: true) }
                        }
                    }
                }
            }
        }
        .formStyle(.grouped)
        // A panel for another map, or another thing on this one, starts at the top
        // with its own fields, not the last one's drafts.
        .id("\(send.surfaceId)/\(panel.title)/\(panel.tab ?? "")")
        .safeAreaInset(edge: .top, spacing: 0) {
            MapPanelHeader(panel: panel, send: send)
        }
    }
}

/// Sends a panel's edits to the surface they came from: a map, or a timeline view.
struct MapPanelSender {
    enum Owner { case map, timeline }

    let bridge: ShellBridge
    let surfaceId: String
    var owner: Owner = .map

    func command(_ name: String, _ detail: [String: Any]? = nil) {
        let detail = detail.map { AnyCodable($0) }
        switch owner {
        case .map: bridge.send(.mapCommand(MapCommandRequest(surfaceId: surfaceId, command: name, detail: detail)))
        case .timeline: bridge.send(.timelineCommand(TimelineCommandRequest(surfaceId: surfaceId, command: name, detail: detail)))
        }
    }

    /// A field's new value; `nil` is `null`, which clears a field that may be empty.
    func field(_ id: String, _ value: Any?) {
        command("panel-field", ["id": id, "value": value ?? NSNull()])
    }

    func action(_ id: String) {
        command("panel-action", ["id": id])
    }
}

/* ---------------- the header ---------------- */

/// Back, the title and any problems, then the tabs while nothing is selected.
private struct MapPanelHeader: View {
    let panel: MapPanel
    let send: MapPanelSender

    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 6) {
                if panel.canGoBack {
                    Button { send.command("panel-back") } label: {
                        Label(send.owner == .map ? "Back to the Map" : "Back to the Timeline", systemImage: "chevron.left").labelStyle(.iconOnly)
                    }
                    .buttonStyle(.borderless)
                    .help(send.owner == .map ? "Back to the map’s settings" : "Back to the timeline’s settings")
                }
                Text(panel.title)
                    .font(.headline)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 0)
                if panel.problems > 0 {
                    Label("\(panel.problems)", systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                        .font(.callout)
                        .help("\(panel.problems) problem\(panel.problems == 1 ? "" : "s") in the journeys")
                }
            }
            if !panel.tabs.isEmpty {
                Picker("Settings", selection: Binding(
                    get: { panel.tab ?? panel.tabs.first?.id ?? "" },
                    set: { send.command("panel-tab", ["id": $0]) })) {
                    ForEach(panel.tabs, id: \.id) { Text($0.label).tag($0.id) }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }
}

/* ---------------- fields ---------------- */

struct MapPanelFieldView: View {
    let field: MapPanelField
    let send: MapPanelSender

    var body: some View {
        switch field {
        case .text(let input): MapTextRow(input: input, send: send)
        case .number(let input): MapNumberRow(input: input, send: send)
        case .choice(let input): MapChoiceRow(input: input, send: send)
        case .toggle(let input):
            Toggle(input.label, isOn: Binding(get: { input.value }, set: { send.field(input.id, $0) }))
        case .color(let input): MapColorRow(input: input, send: send)
        case .stat(let stat):
            LabeledContent(stat.label) {
                if let action = stat.action {
                    MapPanelButtonView(button: action, send: send, small: true)
                } else {
                    Text(stat.value).monospacedDigit().textSelection(.enabled)
                }
            }
        case .note(let note): MapNoteRow(note: note, send: send)
        case .button(let button):
            MapPanelButtonView(button: button, send: send)
        case .buttons(let row):
            MapFlowLayout(spacing: 6) {
                ForEach(row.buttons, id: \.id) { MapPanelButtonView(button: $0, send: send) }
            }
        case .listRow(let row): MapListRowView(row: row, send: send)
        case .markers(let input): MapMarkerGrid(input: input, send: send)
        case .date(let input): MapDateRow(input: input, send: send)
        case .table(let table): MapTableGrid(table: table)
        case .preview(let preview): MapShapePreviewView(preview: preview)
        case .group(let group): MapGroupView(group: group, send: send)
        }
    }
}

struct MapPanelButtonView: View {
    let button: MapPanelButton
    let send: MapPanelSender
    var small = false

    var body: some View {
        let control = Button(role: button.role == .destructive ? .destructive : nil) { send.action(button.id) } label: {
            if let symbol = button.symbol, small {
                Label(button.label, systemImage: symbol).labelStyle(.iconOnly)
            } else {
                Text(button.label)
            }
        }
        .disabled(button.disabled)
        .help(button.help ?? button.label)
        .controlSize(small ? .small : .regular)

        if button.role == .primary {
            control.buttonStyle(.borderedProminent)
        } else {
            control
        }
    }
}

/// Text applied when committed, as the page's inspector applies it. A new `focusKey` is
/// the page asking for a rename: the caret goes here.
private struct MapTextRow: View {
    let input: MapTextInput
    let send: MapPanelSender
    @State private var draft = ""
    @FocusState private var focused: Bool

    var body: some View {
        Group {
            if input.multiline {
                VStack(alignment: .leading, spacing: 4) {
                    Text(input.label)
                    TextField(input.label, text: $draft, prompt: input.placeholder.map { Text($0) }, axis: .vertical)
                        .labelsHidden()
                        .lineLimit(2...6)
                }
            } else {
                TextField(input.label, text: $draft, prompt: input.placeholder.map { Text($0) })
            }
        }
        .focused($focused)
        .onAppear {
            draft = input.value
            if input.focusKey != 0 { focused = true }
        }
        .onChange(of: input.value) { if !focused { draft = input.value } }
        .onChange(of: input.focusKey) { if input.focusKey != 0 { focused = true } }
        .onSubmit(commit)
        .onChange(of: focused) { if !focused { commit() } }
        .onDisappear(perform: commit)
    }

    private func commit() {
        if draft != input.value { send.field(input.id, draft) }
    }
}

/// A number typed, or stepped where it has a step. Empty clears a field that may be
/// empty; anything else that is not a number puts the value back. The page clamps.
private struct MapNumberRow: View {
    let input: MapNumberInput
    let send: MapPanelSender
    @State private var draft = ""
    @FocusState private var focused: Bool

    var body: some View {
        LabeledContent {
            HStack(spacing: 4) {
                TextField(input.label, text: $draft, prompt: Text(input.allowEmpty ? "—" : ""))
                    .labelsHidden()
                    .multilineTextAlignment(.trailing)
                    .frame(minWidth: 56, maxWidth: 90)
                    .focused($focused)
                    .onSubmit(commit)
                if let suffix = input.suffix {
                    Text(suffix).foregroundStyle(.secondary).lineLimit(1).fixedSize()
                }
                if let step = input.step {
                    Stepper(input.label, onIncrement: { nudge(step) }, onDecrement: { nudge(-step) })
                        .labelsHidden()
                }
            }
        } label: {
            Text(input.label)
        }
        .help(input.help ?? "")
        .onAppear { draft = Self.format(input.value) }
        .onChange(of: input.value) { if !focused { draft = Self.format(input.value) } }
        .onChange(of: focused) { if !focused { commit() } }
        .onDisappear(perform: commit)
    }

    private func nudge(_ delta: Double) {
        let next = clamp((input.value ?? input.min ?? 0) + delta)
        draft = Self.format(next)
        send.field(input.id, next)
    }

    private func clamp(_ value: Double) -> Double {
        var next = value
        if let min = input.min { next = Swift.max(min, next) }
        if let max = input.max { next = Swift.min(max, next) }
        return next
    }

    private func commit() {
        let text = draft.trimmingCharacters(in: .whitespaces)
        if text.isEmpty {
            if input.allowEmpty, input.value != nil { send.field(input.id, nil) } else { draft = Self.format(input.value) }
            return
        }
        guard let parsed = try? Double(text, format: .number), parsed.isFinite else {
            draft = Self.format(input.value)
            return
        }
        let next = clamp(parsed)
        if next != input.value { send.field(input.id, next) }
        draft = Self.format(next)
    }

    static func format(_ value: Double?) -> String {
        guard let value else { return "" }
        return value.formatted(.number.precision(.significantDigits(1...10)).grouping(.never))
    }
}

/// A pop-up menu; consecutive options with the same `group` sit under one heading.
private struct MapChoiceRow: View {
    let input: MapChoiceInput
    let send: MapPanelSender

    var body: some View {
        Picker(input.label, selection: Binding(get: { input.value }, set: { send.field(input.id, $0) })) {
            // An option the list no longer has still shows, rather than a blank.
            if !input.options.contains(where: { $0.value == input.value }) {
                Text(input.value).tag(input.value)
            }
            ForEach(Self.runs(of: input.options), id: \.offset) { _, run in
                if let group = run.group {
                    Section(group) {
                        ForEach(run.options, id: \.value) { Text($0.label).tag($0.value) }
                    }
                } else {
                    ForEach(run.options, id: \.value) { Text($0.label).tag($0.value) }
                }
            }
        }
        .help(input.help ?? "")
    }

    private struct Run {
        let group: String?
        var options: [MapChoice]
    }

    private static func runs(of options: [MapChoice]) -> EnumeratedSequence<[Run]> {
        var runs: [Run] = []
        for option in options {
            if let last = runs.indices.last, runs[last].group == option.group {
                runs[last].options.append(option)
            } else {
                runs.append(Run(group: option.group, options: [option]))
            }
        }
        return runs.enumerated()
    }
}

/// A colour well, with Reset while a colour is set.
private struct MapColorRow: View {
    let input: MapColorInput
    let send: MapPanelSender

    var body: some View {
        LabeledContent(input.label) {
            HStack(spacing: 6) {
                if input.value != nil {
                    Button("Reset") { send.field(input.id, nil) }
                        .controlSize(.small)
                }
                ColorPicker(input.label, selection: Binding(
                    get: { Color(hex: input.value ?? input.fallback) ?? .gray },
                    set: { color in
                        guard let hex = color.mapHex, hex != input.value else { return }
                        send.field(input.id, hex)
                    }), supportsOpacity: false)
                    .labelsHidden()
            }
        }
    }
}

private struct MapNoteRow: View {
    let note: MapNoteText
    let send: MapPanelSender

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            if note.tone == .warning {
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
            } else if let swatch = note.swatch {
                Circle().fill(Color(hex: swatch) ?? .gray).frame(width: 10, height: 10)
            }
            Text(note.text)
                .font(note.tone == .warning ? .callout : .caption)
                .foregroundStyle(note.tone == .warning ? .primary : .secondary)
                .fixedSize(horizontal: false, vertical: true)
            if let action = note.action {
                Spacer(minLength: 0)
                MapPanelButtonView(button: action, send: send, small: true)
            }
        }
    }
}

private struct MapListRowView: View {
    let row: MapListRow
    let send: MapPanelSender

    var body: some View {
        Button { send.action(row.id) } label: {
            HStack(spacing: 8) {
                if let swatch = row.swatch {
                    Circle().fill(Color(hex: swatch) ?? .gray).frame(width: 10, height: 10)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.title).lineLimit(1)
                    if let subtitle = row.subtitle {
                        Text(subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
            }
            .padding(.leading, CGFloat(row.indent) * 14)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }
}

/// A place's marker, as symbols: the page draws its own glyphs on the map, and these are
/// their nearest SF Symbols.
private struct MapMarkerGrid: View {
    let input: MapMarkerInput
    let send: MapPanelSender

    static let symbols: [String: String] = [
        "pin": "mappin", "city": "building.2", "town": "house", "castle": "building.columns",
        "port": "ferry", "temple": "sparkles", "tower": "antenna.radiowaves.left.and.right",
        "mountain": "mountain.2", "cave": "circle.bottomhalf.filled", "ruin": "building.columns.fill",
        "camp": "tent", "battle": "flag.2.crossed", "star": "star", "skull": "exclamationmark.octagon",
    ]

    var body: some View {
        let tint = input.color.flatMap { Color(hex: $0) } ?? .accentColor
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 34), spacing: 6)], spacing: 6) {
            ForEach(input.options, id: \.value) { option in
                let chosen = option.value == input.value
                Button { send.field(input.id, option.value) } label: {
                    Image(systemName: Self.symbols[option.value] ?? "mappin")
                        .font(.system(size: 15))
                        .frame(width: 32, height: 32)
                        .foregroundStyle(chosen ? tint : .secondary)
                        .background(chosen ? tint.opacity(0.18) : .clear, in: .rect(cornerRadius: 7))
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .help(option.label)
                .accessibilityLabel(option.label)
                .accessibilityAddTraits(chosen ? .isSelected : [])
            }
        }
    }
}

/// A date in the project's calendar, taken apart by the page and put back together by
/// it: story days are only a day; real and invented calendars add a month and a year.
private struct MapDateRow: View {
    let input: MapDateInput
    let send: MapPanelSender

    var body: some View {
        if let value = input.value {
            LabeledContent(input.label) {
                HStack(spacing: 4) {
                    MapPartField(label: "Day", value: value.day, width: 40) { set(value, day: $0) }
                    if input.mode != .day, !input.months.isEmpty {
                        Picker("Month", selection: Binding(
                            get: { Int(value.month) },
                            set: { set(value, month: Double($0)) })) {
                            ForEach(Array(input.months.enumerated()), id: \.offset) { index, name in
                                Text(String(name.prefix(3))).tag(index + 1)
                            }
                        }
                        .labelsHidden()
                        .fixedSize()
                        MapPartField(label: "Year", value: value.year, width: 52) { set(value, year: $0) }
                    }
                    DatePicker("Time", selection: Binding(
                        get: { Self.time(hour: value.hour, minute: value.minute) },
                        set: { date in
                            let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
                            set(value, hour: Double(parts.hour ?? 0), minute: Double(parts.minute ?? 0))
                        }), displayedComponents: .hourAndMinute)
                        .labelsHidden()
                    if input.allowEmpty {
                        Button { send.field(input.id, nil) } label: {
                            Label("Clear", systemImage: "xmark.circle.fill").labelStyle(.iconOnly)
                        }
                        .buttonStyle(.borderless)
                        .help("Leave when the previous leg arrives")
                    }
                }
            }
        } else {
            LabeledContent(input.label) {
                Button(input.placeholder ?? "Set a Date") {
                    send.field(input.id, ["year": 0, "month": 1, "day": 1, "hour": 0, "minute": 0])
                }
            }
        }
    }

    private func set(_ value: MapDateParts, year: Double? = nil, month: Double? = nil, day: Double? = nil, hour: Double? = nil, minute: Double? = nil) {
        send.field(input.id, [
            "year": year ?? value.year,
            "month": month ?? value.month,
            "day": day ?? value.day,
            "hour": hour ?? value.hour,
            "minute": minute ?? value.minute,
        ])
    }

    private static func time(hour: Double, minute: Double) -> Date {
        Calendar.current.date(from: DateComponents(year: 2000, month: 1, day: 1, hour: Int(hour), minute: Int(minute))) ?? .now
    }
}

/// One whole number of a date, committed on Return or losing focus.
private struct MapPartField: View {
    let label: String
    let value: Double
    let width: CGFloat
    let commit: (Double) -> Void
    @State private var draft = ""
    @FocusState private var focused: Bool

    var body: some View {
        TextField(label, text: $draft)
            .labelsHidden()
            .multilineTextAlignment(.trailing)
            .frame(width: width)
            .focused($focused)
            .onAppear { draft = String(Int(value)) }
            .onChange(of: value) { if !focused { draft = String(Int(value)) } }
            .onSubmit(apply)
            .onChange(of: focused) { if !focused { apply() } }
            .accessibilityLabel(label)
    }

    private func apply() {
        guard let parsed = Int(draft.trimmingCharacters(in: .whitespaces)) else {
            draft = String(Int(value))
            return
        }
        if Double(parsed) != value { commit(Double(parsed)) }
    }
}

/// The distances between places: a row per place, a column per place, scrolling
/// sideways when there are many.
private struct MapTableGrid: View {
    let table: MapTableView

    var body: some View {
        ScrollView(.horizontal) {
            Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 6) {
                GridRow {
                    Text("")
                    ForEach(Array(table.columns.enumerated()), id: \.offset) { _, column in
                        Text(column).font(.caption.weight(.semibold)).lineLimit(1)
                    }
                }
                ForEach(Array(table.rows.enumerated()), id: \.offset) { _, row in
                    GridRow {
                        Text(row.label).font(.caption).lineLimit(1)
                        ForEach(Array(row.cells.enumerated()), id: \.offset) { _, cell in
                            VStack(alignment: .leading, spacing: 1) {
                                Text(cell.text).font(.caption.weight(cell.strong ? .semibold : .regular)).monospacedDigit()
                                if let detail = cell.detail {
                                    Text(detail).font(.caption2).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
            }
            .padding(.vertical, 4)
        }
    }
}

/// A trace's outlines, drawn from the page's path data (`M`, `L` and `Z` only).
private struct MapShapePreviewView: View {
    let preview: MapShapePreview

    var body: some View {
        let path = Self.path(preview.path)
        Canvas { context, size in
            guard preview.width > 0, preview.height > 0 else { return }
            let scale = min(size.width / preview.width, size.height / preview.height)
            let offset = CGPoint(x: (size.width - preview.width * scale) / 2, y: (size.height - preview.height * scale) / 2)
            let drawn = path.applying(CGAffineTransform(translationX: offset.x, y: offset.y).scaledBy(x: scale, y: scale))
            if preview.filled {
                context.fill(drawn, with: .color(.primary.opacity(0.2)), style: FillStyle(eoFill: true))
            }
            context.stroke(drawn, with: .color(.primary), lineWidth: 1)
        }
        .frame(height: 150)
        .background(.quaternary.opacity(0.5), in: .rect(cornerRadius: 8))
        .accessibilityLabel("Trace preview")
    }

    static func path(_ data: String) -> Path {
        var path = Path()
        let scanner = Scanner(string: data)
        scanner.charactersToBeSkipped = .whitespaces
        var command: Character = "M"
        while !scanner.isAtEnd {
            if let letter = scanner.scanCharacter(), "MLZ".contains(letter) {
                command = letter
                if letter == "Z" { path.closeSubpath() }
                continue
            } else {
                scanner.currentIndex = data.index(before: scanner.currentIndex)
            }
            guard let x = scanner.scanDouble(), let y = scanner.scanDouble() else { break }
            let point = CGPoint(x: x, y: y)
            if command == "M" { path.move(to: point); command = "L" } else { path.addLine(to: point) }
        }
        return path
    }
}

/// Rows that belong to one thing. A collapsible group folds away; the others are
/// headed by their title and buttons.
private struct MapGroupView: View {
    let group: MapPanelGroup
    let send: MapPanelSender

    var body: some View {
        if group.collapsible {
            DisclosureGroup {
                fields
            } label: {
                title
            }
        } else {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    title.font(.subheadline.weight(.semibold))
                    Spacer()
                    ForEach(group.actions, id: \.id) { MapPanelButtonView(button: $0, send: send, small: true) }
                }
                fields
            }
            .padding(.vertical, 4)
        }
    }

    private var title: some View {
        HStack(spacing: 6) {
            if let swatch = group.swatch {
                RoundedRectangle(cornerRadius: 2).fill(Color(hex: swatch) ?? .gray).frame(width: 10, height: 10)
            }
            Text(group.title)
        }
    }

    private var fields: some View {
        ForEach(Array(group.fields.enumerated()), id: \.offset) { _, field in
            MapPanelFieldView(field: field, send: send)
        }
    }
}

/// Buttons laid out in rows, wrapping to the panel's width.
private struct MapFlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(width: proposal.width ?? .infinity, subviews: subviews)
        let items = rows.flatMap { $0 }
        let width = items.map(\.frame.maxX).max() ?? 0
        let height = items.map(\.frame.maxY).max() ?? 0
        return CGSize(width: proposal.width ?? width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for row in arrange(width: bounds.width, subviews: subviews) {
            for item in row {
                subviews[item.index].place(
                    at: CGPoint(x: bounds.minX + item.frame.minX, y: bounds.minY + item.frame.minY),
                    proposal: ProposedViewSize(item.frame.size))
            }
        }
    }

    private struct Item {
        let index: Int
        let frame: CGRect
    }

    private func arrange(width: CGFloat, subviews: Subviews) -> [[Item]] {
        var rows: [[Item]] = [[]]
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            if x > 0, x + size.width > width {
                rows.append([])
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            rows[rows.count - 1].append(Item(index: index, frame: CGRect(x: x, y: y, width: size.width, height: size.height)))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        return rows
    }
}

extension Color {
    /// `#rrggbb` in sRGB, as the map stores colours.
    var mapHex: String? {
        #if os(macOS)
        guard let rgb = NSColor(self).usingColorSpace(.sRGB) else { return nil }
        let (red, green, blue) = (rgb.redComponent, rgb.greenComponent, rgb.blueComponent)
        #else
        var (red, green, blue, alpha): (CGFloat, CGFloat, CGFloat, CGFloat) = (0, 0, 0, 0)
        guard UIColor(self).getRed(&red, green: &green, blue: &blue, alpha: &alpha) else { return nil }
        #endif
        let channel = { (value: CGFloat) in Int((min(max(value, 0), 1) * 255).rounded()) }
        return String(format: "#%02x%02x%02x", channel(red), channel(green), channel(blue))
    }
}
