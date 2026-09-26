import Foundation
import SwiftUI

/// The inspector's two sets of panels: one for writing a draft, one for finishing it —
/// editing, laying it out and printing. The small button beside the selector bar swaps
/// between them (`InspectorView`), and Customize Layout… decides what each one holds.
enum InspectorLayout: String, CaseIterable, Identifiable {
    case drafting, finishing
    var id: String { rawValue }

    var title: String {
        switch self {
        case .drafting: "Drafting"
        case .finishing: "Finishing"
        }
    }

    var symbol: String {
        switch self {
        case .drafting: "pencil.line"
        case .finishing: "printer"
        }
    }

    var other: InspectorLayout { self == .drafting ? .finishing : .drafting }

    var defaultTabs: [SidebarModel.Tab] {
        switch self {
        case .drafting: [.clipboard, .workbench, .notes, .references, .history, .stats]
        case .finishing: [.page, .book, .publish, .notes, .references, .history, .stats]
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
    /// it — after the tab it follows in the defaults, where there is one, so Book and
    /// Publish arrive beside Page — rather than a new panel being hidden behind
    /// Customize Layout….
    static let knownTabsKey = "inkblot.inspector.knownTabs"
    /// Tabs added after layouts could first be saved — which is what a saved layout
    /// with no `knownTabsKey` beside it did not know about.
    static let addedLater: Set<SidebarModel.Tab> = [.stats, .book, .publish]

    static func load(from defaults: UserDefaults = .standard) -> InspectorLayouts {
        var layouts = InspectorLayouts()
        let stored = defaults.dictionary(forKey: storageKey) as? [String: [String]] ?? [:]
        let known = defaults.stringArray(forKey: knownTabsKey).map { Set($0.compactMap(SidebarModel.Tab.init(rawValue:))) }
            ?? Set(SidebarModel.Tab.arrangeable).subtracting(addedLater)
        for layout in InspectorLayout.allCases {
            if let raw = stored[layout.rawValue] {
                layouts[layout] = adding(
                    layout.defaultTabs.filter { !known.contains($0) },
                    to: raw.compactMap(SidebarModel.Tab.init(rawValue:)),
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
