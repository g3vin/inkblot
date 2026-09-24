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
        case .drafting: [.clipboard, .workbench, .notes, .references, .history]
        case .finishing: [.page, .notes, .references, .history]
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
            let unique = newValue.filter { seen.insert($0).inserted }
            tabs[layout] = unique.isEmpty ? nil : unique
        }
    }

    /// Every tab, as Customize Layout… lists them for `layout`: the ones it shows, in
    /// order, then the ones it does not.
    func rows(for layout: InspectorLayout) -> [SidebarModel.Tab] {
        let shown = self[layout]
        return shown + SidebarModel.Tab.allCases.filter { !shown.contains($0) }
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

    static func load(from defaults: UserDefaults = .standard) -> InspectorLayouts {
        var layouts = InspectorLayouts()
        let stored = defaults.dictionary(forKey: storageKey) as? [String: [String]] ?? [:]
        for layout in InspectorLayout.allCases {
            if let raw = stored[layout.rawValue] {
                layouts[layout] = raw.compactMap(SidebarModel.Tab.init(rawValue:))
            }
        }
        return layouts
    }

    func save(to defaults: UserDefaults = .standard) {
        let stored = Dictionary(uniqueKeysWithValues: tabs.map { ($0.key.rawValue, $0.value.map(\.rawValue)) })
        defaults.set(stored, forKey: Self.storageKey)
    }
}
