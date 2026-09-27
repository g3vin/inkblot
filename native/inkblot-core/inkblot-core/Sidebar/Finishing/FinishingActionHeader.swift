import AppKit
import SwiftUI

/// The top of the Typeset and Print & Export tabs: what is being worked on, Print and
/// Export, and where the last job got to.
///
/// Pinned above each tab's settings. On Print & Export it carries Print and Export, so
/// they are always in one place and never at the bottom of a long form; Typeset, a step
/// before, shows only what is being worked on and where the last job got to. The scope
/// it sets — this document, or its book — is also what Typeset edits.
struct FinishingActionHeader: View {
    /// Print and Export: on Print & Export, not on Typeset.
    var showsActions = true
    @Environment(AppModel.self) private var model
    @AppStorage(LengthUnit.storageKey) private var unitsRaw = LengthUnit.defaultForLocale.rawValue
    @State private var goingToPage = false
    @State private var goTo = 1
    @State private var editingAuthor = false
    @State private var choosingOptions = false

    var body: some View {
        let layout = model.pageLayout
        VStack(alignment: .leading, spacing: 8) {
            scopeRow(layout)
            if showsActions { actionRow(layout) }
            statusRow(layout)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.bar)
        .overlay(alignment: .bottom) { Divider() }
        .sheet(isPresented: $editingAuthor) {
            AuthorProfileSheet(profile: layout.state?.author ?? AuthorProfile.empty) { layout.setAuthor($0) }
        }
    }

    /* ---------------- what ---------------- */

    private func scopeRow(_ layout: PageLayoutModel) -> some View {
        HStack(spacing: 8) {
            Picker("Work On", selection: Binding(
                get: { layout.scope == .document ? 0 : 1 },
                set: { layout.setScope($0 == 0 ? .document : (layout.scope == .project ? .project : .folder)) }
            )) {
                Text("This Document").tag(0)
                Text("Book").tag(1)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .help("What Print and Export cover, and whose page setup Typeset edits")

            optionsMenu(layout)
        }
    }

    private func optionsMenu(_ layout: PageLayoutModel) -> some View {
        Menu {
            Picker("Units", selection: $unitsRaw) {
                ForEach(LengthUnit.allCases) { Text($0.label).tag($0.rawValue) }
            }
            Button("Author Details…") { editingAuthor = true }
            Divider()
            Button("Expand All Sections") { layout.setExpanded(true, FinishingSectionID.all) }
            Button("Collapse All Sections") { layout.setExpanded(false, FinishingSectionID.all) }
        } label: {
            Image(systemName: "ellipsis.circle")
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .fixedSize()
        .help("Units and view options")
    }

    /* ---------------- do ---------------- */

    private func actionRow(_ layout: PageLayoutModel) -> some View {
        let scope = layout.scope
        let bindable = scope != .document && layout.bindingEnabled
        return HStack(spacing: 8) {
            Group {
                if bindable {
                    Menu {
                        Button("Print for Binding…") { layout.print(scope, bound: true) }
                    } label: {
                        Text("Print…")
                    } primaryAction: {
                        layout.print(scope)
                    }
                } else {
                    Button("Print…") { layout.print(scope) }
                }
            }
            .buttonStyle(.borderedProminent)
            .frame(maxWidth: .infinity)

            Button {
                choosingOptions = true
            } label: {
                Image(systemName: layout.printOptions.isDefault ? "slider.horizontal.3" : "slider.horizontal.below.square.filled.and.square")
            }
            .help("Print options: pages, the current chapter, the selection, a watermark")
            .accessibilityLabel("Print Options")
            .popover(isPresented: $choosingOptions, arrowEdge: .bottom) {
                PrintOptionsPopover(hasSelection: layout.state?.hasSelection ?? false)
            }

            Menu("Export") {
                Self.exportItems(layout, scope: scope, bindable: bindable, script: model.isScript)
            }
            .frame(maxWidth: .infinity)
        }
        .controlSize(.large)
        .disabled(!layout.hasDocument || layout.job.map(Self.isRunning) == true)
    }

    /// The Export menu's items, here and in the File menu.
    @ViewBuilder
    static func exportItems(_ layout: PageLayoutModel, scope: PrintScope, bindable: Bool = false, script: Bool = false) -> some View {
        if let last = layout.lastExport, last.scope == scope {
            Button("Export Again: \(URL(fileURLWithPath: last.path).lastPathComponent)") { layout.exportAgain() }
            Divider()
        }
        Button("PDF…") { layout.export(.pdf, scope: scope) }
        Button("Word (.docx)…") { layout.export(.docx, scope: scope) }
        Button("EPUB…") { layout.export(.epub, scope: scope) }
        Divider()
        Button("Markdown…") { layout.export(.markdown, scope: scope) }
        Button("HTML…") { layout.export(.html, scope: scope) }
        Button("Plain Text…") { layout.export(.plainText, scope: scope) }
        if script {
            Divider()
            Button("Fountain…") { layout.export(.fountain, scope: scope) }
            Button("Final Draft (.fdx)…") { layout.export(.fdx, scope: scope) }
        }
        if bindable {
            Divider()
            Button("PDF for Binding…") { layout.export(.pdf, scope: scope, bound: true) }
        }
        Divider()
        Button("Cover PDF (Full Wrap)…") { layout.export(.coverPdf, scope: scope == .document ? .folder : scope) }
    }

    /* ---------------- where it got to ---------------- */

    @ViewBuilder
    private func statusRow(_ layout: PageLayoutModel) -> some View {
        if let job = layout.job {
            JobStatusLine(job: job, onDismiss: layout.dismissJob)
        } else if let options = layout.printOptions.summary {
            HStack(spacing: 6) {
                Image(systemName: "slider.horizontal.3")
                Text(options).lineLimit(1).truncationMode(.tail)
                Spacer(minLength: 0)
                Button("Reset") { layout.printOptions = PrintOptionsDraft() }
                    .buttonStyle(.link)
            }
            .font(.caption)
            .foregroundStyle(.orange)
        } else if let state = layout.state {
            HStack(spacing: 6) {
                summary(state, layout)
                Spacer(minLength: 0)
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private func summary(_ state: PageLayoutState, _ layout: PageLayoutModel) -> some View {
        if state.scope != .document {
            let chapters = state.bookChapters.count
            Text("\(state.book.title.isEmpty ? "Book" : state.book.title) · \(chapters) chapter\(chapters == 1 ? "" : "s")")
                .lineLimit(1)
                .truncationMode(.middle)
        } else if state.enabled, state.pageCount > 0 {
            Button("Page \(state.currentPage) of \(state.pageCount)") {
                goTo = Int(state.currentPage)
                goingToPage = true
            }
            .buttonStyle(.link)
            .help("Go to a page (⌥⌘G)")
            .popover(isPresented: $goingToPage, arrowEdge: .bottom) {
                goToPagePopover(pageCount: Int(state.pageCount), layout)
            }
        } else if state.docPath != nil {
            Button("Typeset to see the page count") { layout.setMode(.typeset) }
                .buttonStyle(.link)
        }
    }

    private func goToPagePopover(pageCount: Int, _ layout: PageLayoutModel) -> some View {
        HStack(spacing: 8) {
            Text("Go to page")
            TextField("", value: $goTo, format: .number)
                .frame(width: 56)
                .multilineTextAlignment(.trailing)
                .onSubmit { go(layout, pageCount) }
            Text("of \(pageCount)").foregroundStyle(.secondary)
            Button("Go") { go(layout, pageCount) }
                .keyboardShortcut(.defaultAction)
        }
        .padding(12)
    }

    private func go(_ layout: PageLayoutModel, _ pageCount: Int) {
        layout.goToPage(min(max(1, goTo), pageCount))
        goingToPage = false
    }

    static func isRunning(_ job: PrintJobStatus) -> Bool {
        switch job.phase {
        case .preparing, .laying, .writing: true
        case .done, .failed, .cancelled: false
        }
    }
}

/// One job's progress, result or failure, in a line.
struct JobStatusLine: View {
    let job: PrintJobStatus
    let onDismiss: () -> Void

    var body: some View {
        switch job.phase {
        case .preparing, .laying, .writing:
            VStack(alignment: .leading, spacing: 4) {
                if job.phase == .laying, let done = job.done, let total = job.total, total > 1 {
                    ProgressView(value: Double(done), total: Double(total))
                } else {
                    ProgressView().progressViewStyle(.linear)
                }
                Text(Self.running(job)).font(.caption).foregroundStyle(.secondary)
            }
        case .done:
            HStack(spacing: 6) {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                if let path = job.path {
                    Text("Saved \(URL(fileURLWithPath: path).lastPathComponent)")
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Spacer(minLength: 4)
                    Button("Show in Finder") {
                        NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
                    }
                    .buttonStyle(.link)
                } else {
                    Text("Sent to the printer")
                    Spacer(minLength: 0)
                }
            }
            .font(.caption)
        case .failed:
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.red)
                Text("Could not \(job.kind == .export ? "export" : "print"): \(job.message ?? "something went wrong.")")
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                Spacer(minLength: 4)
                Button { onDismiss() } label: { Image(systemName: "xmark") }
                    .buttonStyle(.borderless)
                    .help("Dismiss")
            }
            .font(.caption)
        case .cancelled:
            EmptyView()
        }
    }

    static func running(_ job: PrintJobStatus) -> String {
        let what = job.kind == .export ? "Exporting \(job.format.map(Self.label) ?? "")" : "Printing"
        if job.phase == .laying, let done = job.done, let total = job.total, total > 1 {
            return "\(what): laying out chapter \(min(done + 1, total)) of \(total)…"
        }
        return "\(what)…"
    }

    static func label(_ format: ExportFormat) -> String {
        switch format {
        case .pdf: "PDF"
        case .epub: "EPUB"
        case .markdown: "Markdown"
        case .html: "HTML"
        case .docx: "Word"
        case .plainText: "Plain Text"
        case .fountain: "Fountain"
        case .fdx: "Final Draft"
        case .csv: "Report"
        case .coverPdf: "Cover PDF"
        }
    }
}

/// Every Finishing section's id, for Expand and Collapse All.
enum FinishingSectionID {
    static let thisPage = "typeset.thisPage"
    static let style = "typeset.style"
    static let digital = "typeset.digital"
    static let cover = "output.cover"
    static let pageSize = "page.size"
    static let headerFooter = "page.headerFooter"
    static let textFlow = "page.textFlow"
    static let typography = "page.typography"
    static let titlePage = "page.titlePage"
    static let bookInfo = "book.info"
    static let chapters = "book.chapters"
    static let bookSetup = "book.setup"
    static let headings = "book.headings"
    static let frontMatter = "book.front"
    static let backMatter = "book.back"
    static let binding = "publish.binding"
    static let publishing = "publish.publishing"
    static let script = "publish.script"

    static let all = [thisPage, style, digital, cover, pageSize, headerFooter, typography, titlePage, textFlow, bookInfo, chapters, headings, frontMatter, backMatter, bookSetup, script, publishing, binding]
}

/// A Finishing tab: the action header pinned at the top, the tab's settings scrolling
/// beneath it — or, with nothing to work on, why not.
struct FinishingPanel<Content: View>: View {
    @Environment(AppModel.self) private var model
    /// Whether the tab needs a text document open (Print & Export does; Typeset, whose
    /// book sections stand on their own, does not).
    var needsDocument = true
    /// Print and Export in the header.
    var showsActions = true
    @ViewBuilder var content: Content

    var body: some View {
        let state = model.pageLayout.state
        if let state, !needsDocument || state.docPath != nil {
            Form { content }
                .formStyle(.grouped)
                .safeAreaInset(edge: .top, spacing: 0) {
                    FinishingActionHeader(showsActions: showsActions)
                }
        } else {
            ContentUnavailableView(
                "No Document",
                systemImage: "doc.richtext",
                description: Text("Open a document to set up its pages, print it, or export it."))
        }
    }
}

/// What Print covers and how it is marked: a range of it, and a watermark — for a read
/// copy, a draft sent out, or a copy for each reader with their name across the page.
struct PrintOptionsPopover: View {
    @Environment(AppModel.self) private var model
    let hasSelection: Bool

    var body: some View {
        @Bindable var layout = model.pageLayout
        Form {
            Picker("Print", selection: $layout.printOptions.range) {
                Text("Everything").tag(PrintRange.all)
                Text("The Current Chapter").tag(PrintRange.currentChapter)
                Text("The Selection").tag(PrintRange.selection)
                    .disabled(!hasSelection)
            }
            TextField("Pages", text: $layout.printOptions.pages, prompt: Text("All, or e.g. 3–7, 10"))
            TextField("Watermark", text: $layout.printOptions.watermark, prompt: Text("e.g. DRAFT, or Copy for {recipient}"))
            if !layout.printOptions.watermark.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("A Copy Each For")
                    TextEditor(text: $layout.printOptions.recipients)
                        .font(.body)
                        .frame(height: 54)
                        .scrollContentBackground(.hidden)
                        .background(.background, in: .rect(cornerRadius: 4))
                    Text("One name a line. Each copy has its reader’s name in place of {recipient}; as a PDF, each is a file of its own.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            HStack {
                Button("Reset") { layout.printOptions = PrintOptionsDraft() }
                    .disabled(layout.printOptions.isDefault)
                Spacer()
                Button("Print…") { layout.print(layout.scope) }
                    .keyboardShortcut(.defaultAction)
            }
        }
        .formStyle(.grouped)
        .frame(width: 340)
        .fixedSize(horizontal: false, vertical: true)
    }
}

extension AppModel {
    /// The open document is a screenplay or a stage play: its exports include Fountain
    /// and Final Draft.
    var isScript: Bool {
        guard let format = bridge.toolbar?.writingFormat else { return false }
        return format != .prose
    }

    var hasProject: Bool { bridge.project.projectName != nil }
}
