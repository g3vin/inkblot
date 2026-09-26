import AppKit
import Observation
import SwiftUI

/// Print Layout and the Finishing tabs, as the shell sees them: Typeset and Print &
/// Export, and the File and View menus' print items.
///
/// The page owns every part of it. A document's page setup lives on its doc node, so
/// only the page can change it without racing autosave; the book settings live in
/// preferences the page hydrates. The page publishes `pageLayoutState` (and, once, the
/// `pageLayoutCatalog`) and this model edits by command — see `bridge/print.rs`.
///
/// **The drafts live here, not in the tabs.** A tab is rebuilt every time it is switched
/// to or swiped past, and Typeset and Print & Export edit the same setup and book; held
/// in a view's state, a draft would be thrown away with it.
@MainActor
@Observable
final class PageLayoutModel {
    private(set) var state: PageLayoutState?
    /// Sizes, formats, signature advice and running-head tokens, sent once by the page.
    private(set) var catalog: PageLayoutCatalog?
    /// The latest print or export, while it is worth showing: running, just finished, or
    /// failed (until the next job or it is dismissed).
    private(set) var job: PrintJobStatus?

    /// The setup Typeset edits — the document's, or the book's under a book scope — and
    /// the book both tabs edit. Rebuilt from each state the page
    /// publishes, so an edit made anywhere (an undo in the page, the other pane) shows.
    var setup: PageSetupDraft?
    var book: BookDraft?
    /// How Print (and a PDF) is narrowed and marked, until it is set back: the same for
    /// the header's popover, the File menu and ⌘P, so what the header says is what prints.
    var printOptions = PrintOptionsDraft()

    /// The Finishing sections the author folded away, by id. Kept across launches.
    private(set) var collapsedSections: Set<String> = Set(UserDefaults.standard.stringArray(forKey: PageLayoutModel.collapsedKey) ?? [])

    private static let collapsedKey = "inkblot.finishing.collapsed"

    @ObservationIgnored private let bridge: ShellBridge
    @ObservationIgnored private var screenObserver: NSObjectProtocol?
    @ObservationIgnored private var jobDismissal: Task<Void, Never>?

    /// How long a finished job's "Saved Book.pdf" stays.
    private static let doneLinger: Duration = .seconds(10)

    init(bridge: ShellBridge) {
        self.bridge = bridge
        bridge.addListener { [weak self] event in
            guard let self else { return }
            switch event {
            case .pageLayoutState(let next): receive(next)
            case .pageLayoutCatalog(let next): catalog = next
            case .printJobStatus(let status): receive(status)
            default: break
            }
        }
        // "Actual size" needs the display's real density, which only the shell knows.
        screenObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.sendDisplayDensity() }
        }
    }

    var isEnabled: Bool { state?.enabled ?? false }
    var hasDocument: Bool { state?.docPath != nil }
    var scope: PrintScope { state?.scope ?? .document }
    /// Under a book scope Typeset edits the book's setup, which every chapter
    /// prints in; under the document scope, the document's own.
    var editsBook: Bool { scope != .document }
    var bindingEnabled: Bool { (book?.binding ?? BindingType.none) != BindingType.none }

    /* ---------------- receiving ---------------- */

    private func receive(_ next: PageLayoutState) {
        let previous = state
        state = next
        if previous?.setup != next.setup || previous?.book != next.book || previous?.scope != next.scope || setup == nil {
            setup = PageSetupDraft(editsBook ? (next.book.pageSetup ?? next.setup) : next.setup)
        }
        if previous?.book != next.book || book == nil {
            book = BookDraft(next.book)
        }
    }

    private func receive(_ status: PrintJobStatus) {
        jobDismissal?.cancel()
        // A cancelled job is the author's own doing: nothing to say about it.
        job = status.phase == .cancelled ? nil : status
        guard status.phase == .done else { return }
        let id = status.jobId
        jobDismissal = Task { [weak self] in
            try? await Task.sleep(for: Self.doneLinger)
            guard !Task.isCancelled, let self, self.job?.jobId == id else { return }
            self.job = nil
        }
    }

    func dismissJob() {
        jobDismissal?.cancel()
        job = nil
    }

    /* ---------------- commands ---------------- */

    /// The active document's view, or the one named — a pane's own toggle names its.
    func setPrintLayout(_ enabled: Bool, docPath: String? = nil) {
        bridge.send(.setPrintLayout(SetPrintLayoutCommand(enabled: enabled, docPath: docPath)))
        if enabled { sendDisplayDensity() }
    }

    func setScope(_ scope: PrintScope) {
        bridge.send(.setPrintScope(SetPrintScopeCommand(scope: scope)))
    }

    /// Send the setup draft to whichever setup Typeset edits.
    func apply(_ draft: PageSetupDraft) {
        setup = draft
        bridge.send(.setPageSetup(SetPageSetupCommand(setup: draft.setup, target: editsBook ? .book : .document)))
    }

    func apply(_ draft: BookDraft) {
        book = draft
        bridge.send(.setBookSettings(SetBookSettingsCommand(settings: draft.settings)))
    }

    func applyFormat(_ id: String) {
        bridge.send(.applyFormat(ApplyFormatCommand(formatId: id, target: editsBook ? .book : .document)))
    }

    func useSetupForBook() {
        bridge.send(.useSetupForBook(UseSetupForBookCommand()))
    }

    func clearBookSetup() {
        bridge.send(.clearBookSetup(ClearBookSetupCommand()))
    }

    func setAuthor(_ profile: AuthorProfile) {
        bridge.send(.setAuthorProfile(SetAuthorProfileCommand(profile: profile)))
    }

    /// Give the book a cover from an image file, or take it away with nil.
    func setCover(_ url: URL?) {
        bridge.send(.setBookCover(SetBookCoverCommand(path: url?.path)))
    }

    func refreshChapters() {
        bridge.send(.refreshBookChapters(RefreshBookChaptersCommand()))
    }

    /// Each document has its own zoom: the active one's, or the one named.
    func zoom(_ zoom: Double, docPath: String? = nil) {
        bridge.send(.setPrintZoom(SetPrintZoomCommand(zoom: zoom, fit: nil, docPath: docPath)))
    }

    func fit(_ fit: ZoomFit, docPath: String? = nil) {
        if fit == .actual { sendDisplayDensity() }
        bridge.send(.setPrintZoom(SetPrintZoomCommand(zoom: nil, fit: fit, docPath: docPath)))
    }

    func insertBreak(_ kind: PageBreakKind, target: EditorTarget?) {
        guard let target else { return }
        bridge.send(.insertBreak(InsertBreakCommand(target: target, kind: kind)))
    }

    func goToPage(_ page: Int) {
        bridge.send(.goToPage(GoToPageCommand(page: UInt32(max(1, page)))))
    }

    func print(_ scope: PrintScope, bound: Bool = false) {
        bridge.send(.printDocument(PrintDocumentCommand(scope: scope, bound: bound, options: printOptions.options)))
    }

    /// Export. A PDF is the print saved, so it takes the print options; nothing else does.
    func export(_ format: ExportFormat, scope: PrintScope, bound: Bool = false) {
        let options = format == .pdf ? printOptions.options : PrintOptionsDraft().options
        bridge.send(.exportDocument(ExportDocumentCommand(format: format, scope: scope, bound: bound, options: options)))
    }

    /// Count what Print covers — its pages and words — by laying it all out.
    func measure() {
        bridge.send(.measureBook(MeasureBookCommand()))
    }

    /// Make a preflight fix: the setup it carries, applied as any other edit.
    func fix(_ issue: PreflightIssue) {
        guard let fixed = issue.fixedSetup else { return }
        apply(PageSetupDraft(fixed))
    }

    /* ---------------- script production ---------------- */

    /// Number the script's scenes, stop numbering them, or lock the numbers.
    func setSceneNumbers(_ mode: SceneNumbering) {
        bridge.send(.setSceneNumbers(SetSceneNumbersCommand(mode: mode)))
    }

    func scriptReport(_ report: ScriptReportKind, output: ReportOutput) {
        bridge.send(.scriptReport(ScriptReportCommand(report: report, output: output)))
    }

    /// Sides: the pages the chosen scenes are on, in the script's own numbering, with
    /// the highlight Print would use.
    func printSides(_ scenes: [UInt32]) {
        var sides = PrintOptionsDraft()
        sides.range = .scenes
        sides.scenes = scenes.sorted()
        sides.highlightCharacter = printOptions.highlightCharacter
        bridge.send(.printDocument(PrintDocumentCommand(scope: .document, bound: false, options: sides.options)))
    }

    /// Ask for a Fountain script and make a new document of it.
    func importScript() {
        bridge.send(.importScript(ImportScriptCommand()))
    }

    /// The last export again, to the same file.
    func exportAgain() {
        bridge.send(.exportAgain(ExportAgainCommand()))
    }

    var lastExport: LastExport? { state?.lastExport }

    /// The main display's logical density: points across over inches across.
    func sendDisplayDensity() {
        guard let screen = NSScreen.main,
              let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber
        else { return }
        let millimetres = CGDisplayScreenSize(CGDirectDisplayID(number.uint32Value))
        guard millimetres.width > 0 else { return }
        let pointsPerInch = screen.frame.width / (millimetres.width / 25.4)
        bridge.send(.setDisplayDensity(SetDisplayDensityCommand(pointsPerInch: pointsPerInch)))
    }

    /* ---------------- sections ---------------- */

    func expansion(_ id: String) -> Binding<Bool> {
        Binding(
            get: { !self.collapsedSections.contains(id) },
            set: { expanded in self.setExpanded(expanded, [id]) })
    }

    func setExpanded(_ expanded: Bool, _ ids: [String]) {
        var next = collapsedSections
        if expanded { next.subtract(ids) } else { next.formUnion(ids) }
        guard next != collapsedSections else { return }
        collapsedSections = next
        UserDefaults.standard.set(Array(next).sorted(), forKey: Self.collapsedKey)
    }

    /* ---------------- reading the catalog ---------------- */

    func format(_ id: String?) -> FormatOption? {
        guard let id else { return nil }
        return catalog?.formats.first { $0.id == id }
    }

    /// A list in its catalog order, grouped under each item's heading.
    static func grouped<Item>(_ items: [Item], by group: (Item) -> String) -> [(String, [Item])] {
        var order: [String] = []
        var groups: [String: [Item]] = [:]
        for item in items {
            let key = group(item)
            if groups[key] == nil { order.append(key) }
            groups[key, default: []].append(item)
        }
        return order.map { ($0, groups[$0] ?? []) }
    }
}

/* ---------------- editable copies ---------------- */

// The generated types are immutable, as a protocol's values should be. The Finishing
// tabs edit one of these and send the whole value back.

struct RunningTextDraft: Equatable {
    var left = ""
    var center = ""
    var right = ""

    init(_ text: RunningText?) {
        left = text?.left ?? ""
        center = text?.center ?? ""
        right = text?.right ?? ""
    }

    var text: RunningText { RunningText(left: left, center: center, right: right) }
    var isEmpty: Bool { left.isEmpty && center.isEmpty && right.isEmpty }
}

struct PageSetupDraft: Equatable {
    var presetId: String
    var widthMm: Double
    var heightMm: Double
    var landscape: Bool
    var topMm: Double
    var bottomMm: Double
    var insideMm: Double
    var outsideMm: Double
    var gutterMm: Double
    var mirrorMargins: Bool
    var columns: Int
    var columnGapMm: Double
    var header: RunningTextDraft
    var footer: RunningTextDraft
    var versoDiffers: Bool
    var versoHeader: RunningTextDraft
    var versoFooter: RunningTextDraft
    var headerDistanceMm: Double
    var footerDistanceMm: Double
    var differentFirstPage: Bool
    var pageNumberStart: Int
    var pageNumberFormat: PageNumberFormat
    var widowOrphanLines: Int
    var chapterStartsOnRecto: Bool
    var formatId: String?
    /// Type for print; nil prints in the editor's font.
    var typography: TypographyDraft?
    var titlePage: TitlePageDraft?

    /// The page's limit (`normalizePageSetup`), so the field and the page agree.
    static let pageNumberRange = 0...99_999

    init(_ s: PageSetup) {
        presetId = s.presetId
        widthMm = s.widthMm
        heightMm = s.heightMm
        landscape = s.orientation == .landscape
        topMm = s.margins.topMm
        bottomMm = s.margins.bottomMm
        insideMm = s.margins.insideMm
        outsideMm = s.margins.outsideMm
        gutterMm = s.margins.gutterMm
        mirrorMargins = s.mirrorMargins
        columns = Int(s.columns)
        columnGapMm = s.columnGapMm
        header = RunningTextDraft(s.header)
        footer = RunningTextDraft(s.footer)
        versoDiffers = s.versoHeader != nil || s.versoFooter != nil
        versoHeader = RunningTextDraft(s.versoHeader ?? s.header)
        versoFooter = RunningTextDraft(s.versoFooter ?? s.footer)
        headerDistanceMm = s.headerDistanceMm
        footerDistanceMm = s.footerDistanceMm
        differentFirstPage = s.differentFirstPage
        pageNumberStart = Int(s.pageNumberStart)
        pageNumberFormat = s.pageNumberFormat
        widowOrphanLines = Int(s.widowOrphanLines)
        chapterStartsOnRecto = s.chapterStartsOnRecto
        formatId = s.formatId
        typography = s.typography.map(TypographyDraft.init)
        titlePage = s.titlePage.map(TitlePageDraft.init)
    }

    var setup: PageSetup {
        PageSetup(
            presetId: presetId,
            widthMm: widthMm,
            heightMm: heightMm,
            orientation: landscape ? .landscape : .portrait,
            margins: PageMargins(topMm: topMm, bottomMm: bottomMm, insideMm: insideMm, outsideMm: outsideMm, gutterMm: gutterMm),
            mirrorMargins: mirrorMargins,
            columns: UInt32(max(1, min(3, columns))),
            columnGapMm: columnGapMm,
            header: header.text,
            footer: footer.text,
            versoHeader: versoDiffers ? versoHeader.text : nil,
            versoFooter: versoDiffers ? versoFooter.text : nil,
            // Measured from the paper's edge, so they can be no further in than the
            // margin they sit in — the page holds them to it, and so does this.
            headerDistanceMm: min(max(0, headerDistanceMm), topMm),
            footerDistanceMm: min(max(0, footerDistanceMm), bottomMm),
            differentFirstPage: differentFirstPage,
            pageNumberStart: UInt32(Self.pageNumberRange.clamped(pageNumberStart)),
            pageNumberFormat: pageNumberFormat,
            widowOrphanLines: UInt32(max(1, min(5, widowOrphanLines))),
            chapterStartsOnRecto: chapterStartsOnRecto,
            formatId: formatId,
            typography: typography?.typography,
            titlePage: titlePage?.options)
    }

    /// Pick a size preset, keeping the orientation.
    mutating func choose(_ preset: PageSizeOption) {
        presetId = preset.id
        widthMm = preset.widthMm
        heightMm = preset.heightMm
    }
}

struct TypographyDraft: Equatable {
    var fontFamily: String
    var fontSizePt: Double
    var lineSpacing: LineSpacing
    var lineValue: Double
    var firstLineIndentMm: Double
    var paragraphSpacingPt: Double
    var alignment: PrintAlignment
    var hyphenate: Bool
    var sceneBreak: String
    var chapterOpening: ChapterOpening
    var chapterSinkMm: Double
    var noIndentAfterBreak: Bool

    init(_ t: PrintTypography) {
        fontFamily = t.fontFamily
        fontSizePt = t.fontSizePt
        lineSpacing = t.lineSpacing
        lineValue = t.lineValue
        firstLineIndentMm = t.firstLineIndentMm
        paragraphSpacingPt = t.paragraphSpacingPt
        alignment = t.alignment
        hyphenate = t.hyphenate
        sceneBreak = t.sceneBreak
        chapterOpening = t.chapterOpening
        chapterSinkMm = t.chapterSinkMm
        noIndentAfterBreak = t.noIndentAfterBreak
    }

    var typography: PrintTypography {
        PrintTypography(
            fontFamily: fontFamily, fontSizePt: min(72, max(5, fontSizePt)), lineSpacing: lineSpacing,
            lineValue: lineValue, firstLineIndentMm: max(0, firstLineIndentMm),
            paragraphSpacingPt: max(0, paragraphSpacingPt), alignment: alignment, hyphenate: hyphenate,
            sceneBreak: sceneBreak, chapterOpening: chapterOpening, chapterSinkMm: max(0, chapterSinkMm),
            noIndentAfterBreak: noIndentAfterBreak)
    }

    /// The family a CSS list starts with, unquoted: what the font menu shows.
    var primaryFamily: String {
        let first = fontFamily.split(separator: ",").first.map(String.init) ?? fontFamily
        return first.trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
    }

    /// A family chosen from the font menu, as a CSS list with a fallback of its kind.
    static func cssFamily(_ name: String) -> String {
        let monospaced = ["courier", "mono", "typewriter", "menlo", "consol"].contains { name.lowercased().contains($0) }
        return "\"\(name)\", \(monospaced ? "Courier, monospace" : "Georgia, serif")"
    }
}

struct TitlePageDraft: Equatable {
    var style: TitlePageStyle
    var showContact: Bool
    var showWordCount: Bool

    init(_ o: TitlePageOptions) {
        style = o.style
        showContact = o.showContact
        showWordCount = o.showWordCount
    }

    init(style: TitlePageStyle) {
        self.style = style
        showContact = style != .book
        showWordCount = style == .manuscript
    }

    var options: TitlePageOptions { TitlePageOptions(style: style, showContact: showContact, showWordCount: showWordCount) }
}

struct PrintOptionsDraft: Equatable {
    var range: PrintRange = .all
    /// Printed page numbers, as typed: "3-7, 10".
    var pages = ""
    var watermark = ""
    /// One name a line: a watermarked copy each.
    var recipients = ""
    /// Sides: the scenes to print, by index.
    var scenes: [UInt32] = []
    /// An actor's copy: whose speeches to mark.
    var highlightCharacter = ""

    var names: [String] {
        recipients.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }

    var options: PrintOptions {
        PrintOptions(
            range: range,
            pages: pages.trimmingCharacters(in: .whitespaces),
            watermark: watermark.trimmingCharacters(in: .whitespaces),
            recipients: watermark.isEmpty ? [] : names,
            scenes: range == .scenes ? scenes : [],
            highlightCharacter: highlightCharacter)
    }

    var isDefault: Bool { options == PrintOptionsDraft().options }

    /// What Print will do differently, in a line for the header — or nil when nothing.
    var summary: String? {
        var parts: [String] = []
        switch range {
        case .all: break
        case .currentChapter: parts.append("current chapter")
        case .selection: parts.append("selection")
        case .scenes: parts.append(scenes.count == 1 ? "1 scene" : "\(scenes.count) scenes")
        }
        if !highlightCharacter.isEmpty { parts.append("\(highlightCharacter.capitalized) highlighted") }
        let typed = pages.trimmingCharacters(in: .whitespaces)
        if !typed.isEmpty { parts.append("pages \(typed)") }
        let mark = watermark.trimmingCharacters(in: .whitespaces)
        if !mark.isEmpty {
            parts.append(names.count > 1 ? "watermarked, \(names.count) copies" : "watermarked “\(mark)”")
        }
        return parts.isEmpty ? nil : "Printing " + parts.joined(separator: ", ")
    }
}

struct BookDraft: Equatable {
    var folder: String
    var title: String
    var author: String
    var language: String
    var coverImage: String?
    var pageSetup: PageSetup?
    var binding: BindingType
    var sheetsPerSignature: Int
    var sheetPresetId: String
    var sheetFit: SheetFit
    var duplex: DuplexMode
    var paperThicknessMm: Double
    var cropMarks: Bool
    var includeGuide: Bool
    var excluded: [String]
    var numbering: ChapterNumberStyle
    var numberPrefix: String
    var numberIncludesTitle: Bool
    var halfTitle: Bool
    var copyright: String
    var dedication: String
    var epigraph: String
    var epigraphSource: String
    var contents: Bool
    var acknowledgements: String
    var aboutTheAuthor: String
    var alsoBy: String
    var service: PublishingService
    var paper: PaperStock
    var startAt: Int
    var showInTree: Bool
    var chapterDesign: ChapterDesign?
    var partDesign: ChapterDesign?
    var items: [BookItem]
    var continuous: Bool
    var covers: [CoverSet]
    var activeCover: String?

    init(_ b: BookSettings) {
        folder = b.folder
        title = b.title
        author = b.author
        language = b.language
        coverImage = b.coverImage
        pageSetup = b.pageSetup
        binding = b.binding.binding
        sheetsPerSignature = Int(b.binding.sheetsPerSignature)
        sheetPresetId = b.binding.sheetPresetId
        sheetFit = b.binding.sheetFit
        duplex = b.binding.duplex
        paperThicknessMm = b.binding.paperThicknessMm
        cropMarks = b.binding.cropMarks
        includeGuide = b.binding.includeGuide
        excluded = b.excluded ?? []
        numbering = b.chapterNumbering?.style ?? .none
        numberPrefix = b.chapterNumbering?.prefix ?? "Chapter"
        numberIncludesTitle = b.chapterNumbering?.includeTitle ?? true
        halfTitle = b.frontMatter?.halfTitle ?? false
        copyright = b.frontMatter?.copyright ?? ""
        dedication = b.frontMatter?.dedication ?? ""
        epigraph = b.frontMatter?.epigraph ?? ""
        epigraphSource = b.frontMatter?.epigraphSource ?? ""
        contents = b.frontMatter?.contents ?? false
        acknowledgements = b.backMatter?.acknowledgements ?? ""
        aboutTheAuthor = b.backMatter?.aboutTheAuthor ?? ""
        alsoBy = b.backMatter?.alsoBy ?? ""
        service = b.publishing?.service ?? PublishingService.none
        paper = b.publishing?.paper ?? .cream
        startAt = Int(b.chapterNumbering?.startAt ?? 1)
        showInTree = b.chapterNumbering?.showInTree ?? false
        chapterDesign = b.chapterDesign
        partDesign = b.partDesign
        items = b.items ?? []
        continuous = b.continuous ?? false
        covers = b.covers ?? []
        activeCover = b.activeCover
    }

    /// Leave a chapter in or out of the book.
    mutating func include(_ path: String, _ included: Bool) {
        excluded.removeAll { $0 == path }
        if !included { excluded.append(path) }
    }

    /// The copyright page most books print, for the author to adjust.
    static func suggestedCopyright(title: String, author: String, year: Int = Calendar.current.component(.year, from: .now)) -> String {
        """
        \(title.isEmpty ? "Untitled" : title)
        Copyright © \(year) \(author.isEmpty ? "the author" : author)

        All rights reserved. No part of this book may be reproduced in any form without written permission from the author, except for brief quotations in a review.

        This is a work of fiction. Names, characters, places and incidents are the product of the author’s imagination or are used fictitiously.
        """
    }

    var settings: BookSettings {
        BookSettings(
            folder: folder,
            title: title,
            author: author,
            language: language,
            coverImage: coverImage,
            pageSetup: pageSetup,
            binding: BindingSettings(
                binding: binding,
                sheetsPerSignature: UInt32(max(1, min(8, sheetsPerSignature))),
                sheetPresetId: sheetPresetId,
                sheetFit: sheetFit,
                duplex: duplex,
                paperThicknessMm: max(0, paperThicknessMm),
                cropMarks: cropMarks,
                includeGuide: includeGuide),
            // Always sent, never nil: a missing field would read on the page as "reset".
            excluded: excluded,
            chapterNumbering: ChapterNumbering(
                style: numbering, prefix: numberPrefix, includeTitle: numberIncludesTitle,
                startAt: startAt == 0 ? 0 : 1, showInTree: showInTree),
            frontMatter: FrontMatter(
                halfTitle: halfTitle, copyright: copyright, dedication: dedication,
                epigraph: epigraph, epigraphSource: epigraphSource, contents: contents),
            backMatter: BackMatter(acknowledgements: acknowledgements, aboutTheAuthor: aboutTheAuthor, alsoBy: alsoBy),
            publishing: PublishingTarget(service: service, paper: paper),
            chapterDesign: chapterDesign,
            partDesign: partDesign,
            items: items,
            continuous: continuous,
            covers: covers,
            activeCover: activeCover)
    }
}

extension AuthorProfile {
    static let empty = AuthorProfile(byline: "", legalName: "", address: "", email: "", phone: "", agent: "")
}

extension ClosedRange where Bound: Comparable {
    func clamped(_ value: Bound) -> Bound { Swift.min(Swift.max(value, lowerBound), upperBound) }
}
