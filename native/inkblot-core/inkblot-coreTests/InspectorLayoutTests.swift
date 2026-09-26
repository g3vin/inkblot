import Foundation
import Testing
@testable import inkblot_core

/// The inspector's two layouts, as Customize Layout… edits them and UserDefaults keeps
/// them.
@MainActor
struct InspectorLayoutTests {
    @Test func customizeListsShownTabsFirstThenTheRest() {
        let layouts = InspectorLayouts.defaults
        #expect(layouts.rows(for: .finishing) == [.typeset, .output, .notes, .references, .history, .stats, .clipboard, .workbench])
    }

    /// The map's panel follows the active map; no layout holds it or offers it.
    @Test func noLayoutHoldsTheMapPanel() {
        var layouts = InspectorLayouts.defaults
        #expect(!layouts.rows(for: .drafting).contains(.map))
        layouts[.drafting] = [.map, .notes]
        #expect(layouts[.drafting] == [.notes])
        layouts.set(.map, shown: true, in: .finishing)
        #expect(!layouts[.finishing].contains(.map))
    }

    @Test func aTickedTabGoesLastAndTheLastTabStays() {
        var layouts = InspectorLayouts.defaults
        layouts.set(.clipboard, shown: true, in: .finishing)
        #expect(layouts[.finishing] == [.typeset, .output, .notes, .references, .history, .stats, .clipboard])

        layouts[.drafting] = [.notes]
        layouts.set(.notes, shown: false, in: .drafting)
        #expect(layouts[.drafting] == [.notes])
    }

    @Test func movesKeepShownTabsAheadOfHiddenOnes() {
        var layouts = InspectorLayouts.defaults
        // Typeset, past the hidden clipboard at the bottom: it lands last of the shown.
        layouts.move(in: .finishing, fromOffsets: [0], toOffset: 8)
        #expect(layouts[.finishing] == [.output, .notes, .references, .history, .stats, .typeset])
        layouts.move(in: .finishing, fromOffsets: [5], toOffset: 0)
        #expect(layouts[.finishing] == [.typeset, .output, .notes, .references, .history, .stats])
    }

    @Test func duplicatesAndEmptiesAreRepaired() {
        var layouts = InspectorLayouts.defaults
        layouts[.drafting] = [.notes, .notes, .history]
        #expect(layouts[.drafting] == [.notes, .history])
        layouts[.drafting] = []
        #expect(layouts[.drafting] == InspectorLayout.drafting.defaultTabs)
    }

    @Test func storageRoundTripsAndDropsTabsItNoLongerKnows() throws {
        let defaults = try #require(UserDefaults(suiteName: "InspectorLayoutTests"))
        defer { defaults.removePersistentDomain(forName: "InspectorLayoutTests") }

        var layouts = InspectorLayouts.defaults
        layouts[.finishing] = [.history, .typeset]
        layouts.save(to: defaults)
        #expect(InspectorLayouts.load(from: defaults) == layouts)

        defaults.set(["drafting": ["gone", "notes"]], forKey: InspectorLayouts.storageKey)
        let loaded = InspectorLayouts.load(from: defaults)
        #expect(loaded[.drafting] == [.notes])
        #expect(loaded[.finishing] == InspectorLayout.finishing.defaultTabs)
    }

    @Test func aTabAddedSinceTheLayoutWasSavedJoinsTheLayoutsThatHaveItByDefault() throws {
        let defaults = try #require(UserDefaults(suiteName: "InspectorLayoutTests.added"))
        defer { defaults.removePersistentDomain(forName: "InspectorLayoutTests.added") }

        // Saved by a build that had no Stats tab, and so no list of known tabs.
        defaults.set(["drafting": ["notes", "history"]], forKey: InspectorLayouts.storageKey)
        var loaded = InspectorLayouts.load(from: defaults)
        #expect(loaded[.drafting] == [.notes, .history, .stats])

        // Once the writer has hidden it, it stays hidden.
        loaded.set(.stats, shown: false, in: .drafting)
        loaded.save(to: defaults)
        #expect(InspectorLayouts.load(from: defaults)[.drafting] == [.notes, .history])
    }

    @Test func printAndExportArrivesBesideTypesetInALayoutSavedBeforeIt() throws {
        let defaults = try #require(UserDefaults(suiteName: "InspectorLayoutTests.finishing"))
        defer { defaults.removePersistentDomain(forName: "InspectorLayoutTests.finishing") }

        // Saved by the build that added Stats: it knew every tab but Book and Publish.
        defaults.set(["finishing": ["history", "page", "stats"]], forKey: InspectorLayouts.storageKey)
        defaults.set(["clipboard", "workbench", "notes", "references", "history", "page", "stats"], forKey: InspectorLayouts.knownTabsKey)
        var loaded = InspectorLayouts.load(from: defaults)
        #expect(loaded[.finishing] == [.history, .typeset, .output, .stats])

        // Once, only: hidden by the writer, it stays hidden.
        loaded.set(.output, shown: false, in: .finishing)
        loaded.save(to: defaults)
        #expect(InspectorLayouts.load(from: defaults)[.finishing] == [.history, .typeset, .stats])
    }

    /// Page and Book became Typeset, and Publish became Print & Export: a layout saved
    /// with the old tabs shows the new ones where they were, and one hidden stays hidden.
    @Test func pageBookAndPublishBecomeTypesetAndPrintAndExport() throws {
        let defaults = try #require(UserDefaults(suiteName: "InspectorLayoutTests.renamed"))
        defer { defaults.removePersistentDomain(forName: "InspectorLayoutTests.renamed") }

        let known = ["clipboard", "workbench", "notes", "references", "history", "page", "book", "publish", "stats"]
        defaults.set(known, forKey: InspectorLayouts.knownTabsKey)
        defaults.set(["finishing": ["history", "page", "book", "publish", "stats"]], forKey: InspectorLayouts.storageKey)
        #expect(InspectorLayouts.load(from: defaults)[.finishing] == [.history, .typeset, .output, .stats])

        defaults.set(["finishing": ["book", "notes"]], forKey: InspectorLayouts.storageKey)
        #expect(InspectorLayouts.load(from: defaults)[.finishing] == [.typeset, .notes])
        #expect(InspectorLayouts.tabs(from: ["page", "gone", "book", "notes"]) == [.typeset, .notes])
    }

    /// The layouts are the window's modes' panels, each way round.
    @Test func eachLayoutIsAModesPanels() {
        #expect(InspectorLayout.drafting.mode == .write && InspectorLayout.finishing.mode == .typeset)
        #expect(InspectorLayout(.typeset) == .finishing && InspectorLayout(.write) == .drafting)
        #expect(InspectorLayout.finishing.title == "Typeset" && InspectorLayout.drafting.title == "Write")
    }

    @Test func aNewTabWithNothingBeforeItGoesLast() {
        #expect(InspectorLayouts.adding([.output], to: [.notes], defaults: [.typeset, .output, .notes]) == [.notes, .output])
        #expect(InspectorLayouts.adding([.typeset, .output], to: [.history], defaults: [.typeset, .output, .history]) == [.history, .typeset, .output])
    }
}
