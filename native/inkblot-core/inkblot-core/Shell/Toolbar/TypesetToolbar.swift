import SwiftUI

/// A document's toolbar in Typeset mode: the book's tools, not the text's.
///
/// A book's look comes from its styles, so the formatting controls — font, size,
/// colour — are not here: they are Write's, where the prose is written. What is here is
/// what a typesetter reaches for: breaks, the zoom of the pages, and getting the book
/// out. Customizable (`ToolbarID.typeset`); see `ToolbarItemID` before adding one.
struct TypesetToolbar: CustomizableToolbarContent {
    let model: AppModel

    var body: some CustomizableToolbarContent {
        ToolbarItem(id: ToolbarItemID.editorMode.id) { EditorModePicker(model: model) }

        ToolbarItem(id: ToolbarItemID.typesetView.id) {
            let layout = model.pageLayout
            Picker("View", selection: Binding(get: { layout.typesetView }, set: { layout.setTypesetView($0) })) {
                Label("Print", systemImage: "book.pages").tag(TypesetView.print)
                Label("Digital", systemImage: "ipad.and.iphone").tag(TypesetView.digital)
            }
            .pickerStyle(.segmented)
            .help("The printed pages, or the e-book as a reader shows it")
            .disabled(!layout.hasDocument)
        }

        ToolbarItem(id: ToolbarItemID.typesetSpread.id) {
            let layout = model.pageLayout
            Picker("Pages", selection: Binding(get: { layout.spread }, set: { layout.setDisplay(spread: $0) })) {
                Label("Single Pages", systemImage: "doc").tag(false)
                Label("Spreads", systemImage: "book").tag(true)
            }
            .pickerStyle(.segmented)
            .help("One page at a time, or the book as it opens: facing pages side by side")
            .disabled(!layout.hasDocument || layout.typesetView == .digital)
        }

        ToolbarItem(id: ToolbarItemID.typesetProof.id) {
            let layout = model.pageLayout
            Toggle(isOn: Binding(get: { layout.proof }, set: { layout.setDisplay(proof: $0) })) {
                Label("Proof", systemImage: "checkmark.seal")
            }
            .help("Mark loose lines, widows, orphans, runts and stacked hyphens on the pages")
            .disabled(!layout.hasDocument)
        }

        ToolbarItem(id: ToolbarItemID.typesetGrid.id) {
            let layout = model.pageLayout
            Toggle(isOn: Binding(get: { layout.showGrid }, set: { layout.setDisplay(grid: $0) })) {
                Label("Baseline Grid", systemImage: "line.3.horizontal")
            }
            .help("Show the baseline grid over the text")
            .disabled(!layout.hasDocument)
        }
        .defaultCustomization(.hidden)

        ToolbarItem(id: ToolbarItemID.typesetTighten.id) {
            Button("Tighten", systemImage: "arrow.right.and.line.vertical.and.arrow.left") {
                model.pageLayout.setParagraph(nudge: -PageLayoutModel.trackingStep)
            }
            .help("Set the paragraph a little tighter, to take a line back")
            .disabled(model.pageLayout.paragraph == nil)
        }
        .defaultCustomization(.hidden)

        ToolbarItem(id: ToolbarItemID.typesetLoosen.id) {
            Button("Loosen", systemImage: "arrow.left.and.line.vertical.and.arrow.right") {
                model.pageLayout.setParagraph(nudge: PageLayoutModel.trackingStep)
            }
            .help("Set the paragraph a little looser, to push a word over")
            .disabled(model.pageLayout.paragraph == nil)
        }
        .defaultCustomization(.hidden)

        ToolbarItem(id: ToolbarItemID.typesetKeepTogether.id) {
            let paragraph = model.pageLayout.paragraph
            Toggle(isOn: Binding(
                get: { paragraph?.keepTogether ?? false },
                set: { model.pageLayout.setParagraph(keepTogether: $0) })) {
                Label("Keep Together", systemImage: "rectangle.compress.vertical")
            }
            .help("Never split this paragraph across pages")
            .disabled(paragraph == nil)
        }
        .defaultCustomization(.hidden)

        ToolbarItem(id: ToolbarItemID.namedTextStyle.id) { TextStyleMenu(model: model) }

        ToolbarSpacer(.fixed)

        ToolbarItem(id: ToolbarItemID.typesetInsert.id) {
            let target = model.bridge.toolbar?.target
            Menu {
                Button("Page Break") { insert(.page) }
                Button("Next Right-Hand Page") { insert(.recto) }
                Button("Column Break") { insert(.column) }
            } label: {
                Label("Insert", systemImage: "rectangle.split.1x2")
            }
            .help("Start what follows on a new page")
            .disabled(target == nil)
        }

        ToolbarItem(id: ToolbarItemID.typesetZoom.id) {
            let layout = model.pageLayout
            Menu {
                Button("Fit Width") { layout.fit(.width) }
                Button("Fit Page") { layout.fit(.page) }
                Button("Actual Size") { layout.fit(.actual) }
                Divider()
                ForEach([0.5, 0.75, 1, 1.25, 1.5, 2], id: \.self) { z in
                    Button("\(Int(z * 100))%") { layout.zoom(z) }
                }
            } label: {
                Label("Zoom", systemImage: "plus.magnifyingglass")
            }
            .help("Zoom the pages")
            .disabled(!layout.hasDocument)
        }

        ToolbarSpacer(.flexible)

        ToolbarItem(id: ToolbarItemID.typesetPrint.id) {
            Button("Print", systemImage: "printer") { model.pageLayout.print(model.pageLayout.scope) }
                .help("Print what Typeset is working on (⌘P)")
                .disabled(!model.pageLayout.hasDocument)
        }

        ToolbarItem(id: ToolbarItemID.typesetExport.id) {
            let layout = model.pageLayout
            Menu {
                FinishingActionHeader.exportItems(layout, scope: layout.scope, script: model.isScript)
            } label: {
                Label("Export", systemImage: "square.and.arrow.up")
            }
            .help("Export the book or the document")
            .disabled(!layout.hasDocument)
        }

        SharedToolbarItems(model: model)
    }

    private func insert(_ kind: PageBreakKind) {
        model.pageLayout.insertBreak(kind, target: model.target)
    }
}

/// Write | Typeset: the window's mode, first in the document and typeset toolbars.
struct EditorModePicker: View {
    let model: AppModel

    var body: some View {
        Picker("Mode", selection: Binding(
            get: { model.pageLayout.mode },
            set: { mode in withAnimation(.smooth(duration: 0.25)) { model.pageLayout.setMode(mode) } }
        )) {
            Label("Write", systemImage: "pencil.line").tag(EditorMode.write)
            Label("Typeset", systemImage: "textformat").tag(EditorMode.typeset)
        }
        .pickerStyle(.segmented)
        .help("Write the draft, or typeset it as a book (⌥⌘P)")
        .disabled(!model.hasProject)
    }
}
