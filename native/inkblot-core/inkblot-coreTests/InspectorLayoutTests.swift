import Foundation
import Testing
@testable import inkblot_core

/// The inspector's two layouts, as Customize Layout… edits them and UserDefaults keeps
/// them.
@MainActor
struct InspectorLayoutTests {
    @Test func customizeListsShownTabsFirstThenTheRest() {
        let layouts = InspectorLayouts.defaults
        #expect(layouts.rows(for: .finishing) == [.page, .book, .publish, .notes, .references, .history, .stats, .clipboard, .workbench])
    }

    @Test func aTickedTabGoesLastAndTheLastTabStays() {
        var layouts = InspectorLayouts.defaults
        layouts.set(.clipboard, shown: true, in: .finishing)
        #expect(layouts[.finishing] == [.page, .book, .publish, .notes, .references, .history, .stats, .clipboard])

        layouts[.drafting] = [.notes]
        layouts.set(.notes, shown: false, in: .drafting)
        #expect(layouts[.drafting] == [.notes])
    }

    @Test func movesKeepShownTabsAheadOfHiddenOnes() {
        var layouts = InspectorLayouts.defaults
        // Page, past the hidden clipboard at the bottom: it lands last of the shown.
        layouts.move(in: .finishing, fromOffsets: [0], toOffset: 9)
        #expect(layouts[.finishing] == [.book, .publish, .notes, .references, .history, .stats, .page])
        layouts.move(in: .finishing, fromOffsets: [6], toOffset: 0)
        #expect(layouts[.finishing] == [.page, .book, .publish, .notes, .references, .history, .stats])
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
        layouts[.finishing] = [.history, .page]
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

    @Test func bookAndPublishArriveBesidePageInALayoutSavedBeforeThem() throws {
        let defaults = try #require(UserDefaults(suiteName: "InspectorLayoutTests.finishing"))
        defer { defaults.removePersistentDomain(forName: "InspectorLayoutTests.finishing") }

        // Saved by the build that added Stats: it knew every tab but Book and Publish.
        defaults.set(["finishing": ["history", "page", "stats"]], forKey: InspectorLayouts.storageKey)
        defaults.set(["clipboard", "workbench", "notes", "references", "history", "page", "stats"], forKey: InspectorLayouts.knownTabsKey)
        var loaded = InspectorLayouts.load(from: defaults)
        #expect(loaded[.finishing] == [.history, .page, .book, .publish, .stats])

        // Once, only: hidden by the writer, they stay hidden.
        loaded.set(.publish, shown: false, in: .finishing)
        loaded.save(to: defaults)
        #expect(InspectorLayouts.load(from: defaults)[.finishing] == [.history, .page, .book, .stats])
    }

    @Test func aNewTabWithNothingBeforeItGoesLast() {
        #expect(InspectorLayouts.adding([.book], to: [.notes], defaults: [.page, .book, .notes]) == [.notes, .book])
        #expect(InspectorLayouts.adding([.book, .publish], to: [.page], defaults: [.page, .book, .publish]) == [.page, .book, .publish])
    }
}
