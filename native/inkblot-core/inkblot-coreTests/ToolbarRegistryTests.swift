import Testing
@testable import inkblot_core

/// The toolbar ids are storage keys: AppKit saves a customized layout as a list of them,
/// under the toolbar's id. So they are pinned here, literally — a rename that compiles
/// everywhere else fails this, which is the moment to decide it should not happen.
struct ToolbarRegistryTests {
    /// Every item id, in declaration order. Add a new item's raw value here; never
    /// change or remove an existing one.
    static let expected = [
        "inkblot.format.font",
        "inkblot.format.font-size",
        "inkblot.format.text-style",
        "inkblot.format.text-color",
        "inkblot.format.highlight",
        "inkblot.format.alignment",
        "inkblot.format.paragraph-style",
        "inkblot.format.bulleted-list",
        "inkblot.format.numbered-list",
        "inkblot.insert.table",
        "inkblot.insert.conversation",
        "inkblot.edit.undo-redo",
        "inkblot.edit.paste-and-match-style",
        "inkblot.view.focus-mode",
        "inkblot.view.word-count",
        "inkblot.canvas.lock",
        "inkblot.canvas.add-card",
        "inkblot.canvas.add-image",
        "inkblot.canvas.record-memo",
        "inkblot.canvas.color",
        "inkblot.canvas.group",
        "inkblot.canvas.undo-redo",
        "inkblot.canvas.alignment-guides",
        "inkblot.canvas.snap-to-grid",
        "inkblot.canvas.zoom",
        "inkblot.canvas.delete",
        "inkblot.history.snapshot",
        "inkblot.panel.clipboard",
        "inkblot.panel.workbench",
        "inkblot.panel.notes",
        "inkblot.panel.history",
        "inkblot.panel.references",
        "inkblot.panel.stats",
        "inkblot.timer",
        "inkblot.window.inspector-toggle",
    ]

    @Test func theIdsAreTheOnesLayoutsWereSavedUnder() {
        #expect(ToolbarItemID.allCases.map(\.rawValue) == Self.expected)
    }

    @Test func noTwoItemsShareAnId() {
        let ids = ToolbarItemID.allCases.map(\.rawValue)
        #expect(Set(ids).count == ids.count)
    }

    @Test func everyIdIsNamespaced() {
        for id in ToolbarItemID.allCases.map(\.rawValue) + [ToolbarID.document, ToolbarID.canvas] {
            #expect(id.hasPrefix("inkblot."), "\(id)")
        }
    }

    @Test func theTwoToolbarsSaveApart() {
        #expect(ToolbarID.document != ToolbarID.canvas)
    }
}
