import Foundation
import SwiftUI

/// The inspector's two sets of panels: one for writing a draft, one for typesetting it
/// and getting it out. They are the window's two modes' panels (`EditorMode`): choosing
/// one switches the mode, and switching the mode brings its layout. The small button
/// beside the selector bar swaps between them (`InspectorView`), and Customize Layout…
/// decides what each one holds. The raw values are storage keys and stay as they were.
enum InspectorLayout: String, CaseIterable, Identifiable {
    case drafting, finishing
    var id: String { rawValue }

    var title: String {
        switch self {
        case .drafting: "Write"
        case .finishing: "Typeset"
        }
    }

    var symbol: String {
        switch self {
        case .drafting: "pencil.line"
        case .finishing: "textformat"
        }
    }

    /// The window mode this layout is the panels of.
    var mode: EditorMode { self == .finishing ? .typeset : .write }

    init(_ mode: EditorMode) {
        self = mode == .typeset ? .finishing : .drafting
    }

    var other: InspectorLayout { self == .drafting ? .finishing : .drafting }

    var defaultTabs: [SidebarModel.Tab] {
        switch self {
        case .drafting: [.clipboard, .workbench, .notes, .references, .history, .stats]
        case .finishing: [.typeset, .output, .notes, .references, .history, .stats]
        }
    }
}

/// Which panels each layout shows, and in what order.
///
/// Always usable: a tab appears at most once in a layout, and a layout is never empty —
/// one that would be falls back to its defaults. Pure; `SidebarModel` holds it and
/// saves it (`load`, `save`).
struct InspectorLayouts: Equatable {
    private var tabs: [InspectorLayout: [SidebarModel.Tab]] = [:]

    static let defaults = InspectorLayouts()

    subscript(layout: InspectorLayout) -> [SidebarModel.Tab] {
        get { tabs[layout] ?? layout.defaultTabs }
        set {
            var seen = Set<SidebarModel.Tab>()
            let unique = newValue.filter { $0 != .map && seen.insert($0).inserted }
            tabs[layout] = unique.isEmpty ? nil : unique
        }
    }

    /// Every tab, as Customize Layout… lists them for `layout`: the ones it shows, in
    /// order, then the ones it does not.
    func rows(for layout: InspectorLayout) -> [SidebarModel.Tab] {
        let shown = self[layout]
        return shown + SidebarModel.Tab.arrangeable.filter { !shown.contains($0) }
    }

    /// Show or hide `tab` in `layout`. A newly shown tab goes last; the last tab a
    /// layout shows cannot be hidden.
    mutating func set(_ tab: SidebarModel.Tab, shown: Bool, in layout: InspectorLayout) {
        var current = self[layout]
        if shown {
            if !current.contains(tab) { current.append(tab) }
        } else if current != [tab] {
            current.removeAll { $0 == tab }
        }
        self[layout] = current
    }

    /// A drag in Customize Layout…'s list, whose offsets count every row (`rows(for:)`).
    /// Only shown tabs move, and they stay ahead of the hidden ones wherever they land.
    mutating func move(in layout: InspectorLayout, fromOffsets source: IndexSet, toOffset destination: Int) {
        let shown = Set(self[layout])
        var rows = rows(for: layout)
        rows.move(fromOffsets: source, toOffset: destination)
        self[layout] = rows.filter(shown.contains)
    }

    /* ---------------- storage ---------------- */

    /// The key the layouts are kept under: layout → its tabs' raw values. Tabs a later
    /// version no longer has are dropped as they are read.
    static let storageKey = "inkblot.inspector.layouts"
    /// The tabs there were when the layouts were last saved. A tab added since then is
    /// one the writer never chose to leave out, so a layout that has it by default gets
    /// it — after the tab it follows in the defaults, where there is one, so Print &
    /// Export arrives beside Typeset — rather than a new panel being hidden behind
    /// Customize Layout….
    static let knownTabsKey = "inkblot.inspector.knownTabs"
    /// Tabs added after layouts could first be saved — which is what a saved layout
    /// with no `knownTabsKey` beside it did not know about.
    static let addedLater: Set<SidebarModel.Tab> = [.stats, .typeset, .output]

    /// Tabs that became others: Page and Book are Typeset now, Publish is Print & Export.
    /// A saved layout names them by their old raw values.
    static let renamed: [String: SidebarModel.Tab] = ["page": .typeset, "book": .typeset, "publish": .output]

    /// A saved list of raw values as tabs: renamed ones as what they became, each once.
    static func tabs(from raw: [String]) -> [SidebarModel.Tab] {
        var seen = Set<SidebarModel.Tab>()
        return raw.compactMap { SidebarModel.Tab(rawValue: $0) ?? renamed[$0] }.filter { seen.insert($0).inserted }
    }

    static func load(from defaults: UserDefaults = .standard) -> InspectorLayouts {
        var layouts = InspectorLayouts()
        let stored = defaults.dictionary(forKey: storageKey) as? [String: [String]] ?? [:]
        let known = defaults.stringArray(forKey: knownTabsKey).map { Set(tabs(from: $0)) }
            ?? Set(SidebarModel.Tab.arrangeable).subtracting(addedLater)
        for layout in InspectorLayout.allCases {
            if let raw = stored[layout.rawValue] {
                layouts[layout] = adding(
                    layout.defaultTabs.filter { !known.contains($0) },
                    to: tabs(from: raw),
                    defaults: layout.defaultTabs)
            }
        }
        return layouts
    }

    /// `saved` with each of `new` it lacks, each placed after the nearest tab before it
    /// in `defaults` that `saved` shows — or last, when there is none.
    static func adding(_ new: [SidebarModel.Tab], to saved: [SidebarModel.Tab], defaults: [SidebarModel.Tab]) -> [SidebarModel.Tab] {
        var result = saved
        for tab in new where !result.contains(tab) {
            let before = defaults.prefix { $0 != tab }
            if let anchor = before.last(where: result.contains), let index = result.firstIndex(of: anchor) {
                result.insert(tab, at: index + 1)
            } else {
                result.append(tab)
            }
        }
        return result
    }

    func save(to defaults: UserDefaults = .standard) {
        let stored = Dictionary(uniqueKeysWithValues: tabs.map { ($0.key.rawValue, $0.value.map(\.rawValue)) })
        defaults.set(stored, forKey: Self.storageKey)
        defaults.set(SidebarModel.Tab.arrangeable.map(\.rawValue), forKey: Self.knownTabsKey)
    }
}
