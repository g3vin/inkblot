import Foundation

/// The window's four customizable toolbars.
///
/// A document, a canvas and a map each have their own, and a document in Typeset mode has
/// the typeset one: their own default set, and their own layout once the user has changed it. AppKit saves a customized layout under the
/// toolbar's id (NSToolbar autosave, in UserDefaults), so these strings are storage
/// keys as much as names — renaming one quietly resets everyone's layout.
enum ToolbarID {
    static let document = "inkblot.toolbar.document"
    static let canvas = "inkblot.toolbar.canvas"
    static let map = "inkblot.toolbar.map"
    static let typeset = "inkblot.toolbar.typeset"
}

/// Every item either toolbar can hold, whether it starts in the toolbar or only in the
/// Customize Toolbar palette.
///
/// A saved layout is a list of these raw values, so they are permanent: **never rename
/// or reuse one.** An item that goes away keeps its case, marked deprecated, until
/// nobody's layout can still name it; AppKit skips ids a toolbar no longer offers.
///
/// Adding an item — the whole recipe is in ARCHITECTURE.md, "A toolbar item":
///
/// 1. A case here, with a new `inkblot.<area>.<name>` string.
/// 2. A `ToolbarItem(id:)` in `DocumentToolbar`, `CanvasToolbar`, `MapToolbar`, or —
///    for one that belongs in all of them — `SharedToolbarItems`.
/// 3. `.defaultCustomization(.hidden)` unless it belongs in the default set. Most new
///    items do not: the palette is where they are found, and the default set is what
///    every new user sees.
/// 4. A `Label` with a title and a symbol even if the toolbar shows only the icon — the
///    palette shows both, and the title is what the item is called in text-only mode.
/// 5. Disabled when it cannot act, never left out: an `if` around an item punches a
///    hole in the user's layout and moves everything after it.
/// 6. Its raw value in `ToolbarRegistryTests.expected`.
enum ToolbarItemID: String, CaseIterable {
    /* ---------------- document ---------------- */

    case font = "inkblot.format.font"
    case fontSize = "inkblot.format.font-size"
    case textStyle = "inkblot.format.text-style"
    case textColor = "inkblot.format.text-color"
    case highlight = "inkblot.format.highlight"
    case alignment = "inkblot.format.alignment"
    case paragraphStyle = "inkblot.format.paragraph-style"
    case bulletedList = "inkblot.format.bulleted-list"
    case numberedList = "inkblot.format.numbered-list"
    case insertTable = "inkblot.insert.table"
    case insertConversation = "inkblot.insert.conversation"
    case documentHistory = "inkblot.edit.undo-redo"
    case pasteAndMatchStyle = "inkblot.edit.paste-and-match-style"
    case focusMode = "inkblot.view.focus-mode"
    case wordCount = "inkblot.view.word-count"

    /* ---------------- canvas ---------------- */

    case canvasLock = "inkblot.canvas.lock"
    case canvasAddCard = "inkblot.canvas.add-card"
    case canvasAddImage = "inkblot.canvas.add-image"
    case canvasRecordMemo = "inkblot.canvas.record-memo"
    case canvasColor = "inkblot.canvas.color"
    case canvasGroup = "inkblot.canvas.group"
    case canvasHistory = "inkblot.canvas.undo-redo"
    case canvasGuides = "inkblot.canvas.alignment-guides"
    case canvasSnap = "inkblot.canvas.snap-to-grid"
    case canvasZoom = "inkblot.canvas.zoom"
    case canvasDelete = "inkblot.canvas.delete"

    /* ---------------- map ---------------- */

    case mapDrawingTools = "inkblot.map.drawing-tools"
    case mapMeasureTools = "inkblot.map.measure-tools"
    case mapHistory = "inkblot.map.undo-redo"
    case mapZoom = "inkblot.map.zoom"
    case mapDelete = "inkblot.map.delete"

    /* ---------------- all of them ---------------- */

    case snapshot = "inkblot.history.snapshot"
    case clipboardPanel = "inkblot.panel.clipboard"
    case workbenchPanel = "inkblot.panel.workbench"
    case notesPanel = "inkblot.panel.notes"
    case historyPanel = "inkblot.panel.history"
    case referencesPanel = "inkblot.panel.references"
    case statsPanel = "inkblot.panel.stats"
    case writingTimer = "inkblot.timer"
    case newTab = "inkblot.tabs.new-tab"
    case split = "inkblot.tabs.split"
    /* ---------------- typeset ---------------- */

    /// Write | Typeset. In the document toolbar and the typeset one, first in both.
    case editorMode = "inkblot.view.editor-mode"
    case typesetView = "inkblot.typeset.view"
    case typesetInsert = "inkblot.typeset.insert"
    case typesetZoom = "inkblot.typeset.zoom"
    case typesetPrint = "inkblot.typeset.print"
    case typesetExport = "inkblot.typeset.export"

    /// Retired: the toggle is a titlebar accessory (`InspectorTitlebarToggle`), not a
    /// toolbar item. Kept because saved layouts may still name it.
    case inspectorToggle = "inkblot.window.inspector-toggle"

    var id: String { rawValue }
}
