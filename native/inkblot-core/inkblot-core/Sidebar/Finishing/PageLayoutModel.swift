import AppKit
import Observation
import SwiftUI

/// Print Layout and the Finishing tabs, as the shell sees them: Page, Book and Publish,
/// and the File and View menus' print items.
///
/// The page owns every part of it. A document's page setup lives on its doc node, so
/// only the page can change it without racing autosave; the book settings live in
/// preferences the page hydrates. The page publishes `pageLayoutState` (and, once, the
/// `pageLayoutCatalog`) and this model edits by command — see `bridge/print.rs`.
///
/// **The drafts live here, not in the tabs.** A tab is rebuilt every time it is switched
/// to or swiped past, and Page, Book and Publish all edit the same setup and book; held
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

    /// The setup the Page tab edits — the document's, or the book's under a book scope —
    /// and the book the Book and Publish tabs edit. Rebuilt from each state the page
    /// publishes, so an edit made anywhere (an undo in the page, the other pane) shows.
    var setup: PageSetupDraft?
    var book: BookDraft?

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
    /// Under a book scope the Page tab edits the book's setup, which every chapter
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

    func setPrintLayout(_ enabled: Bool) {
        bridge.send(.setPrintLayout(SetPrintLayoutCommand(enabled: enabled)))
        if enabled { sendDisplayDensity() }
    }

    func setScope(_ scope: PrintScope) {
        bridge.send(.setPrintScope(SetPrintScopeCommand(scope: scope)))
    }

    /// Send the setup draft to whichever setup the Page tab edits.
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

    func refreshChapters() {
        bridge.send(.refreshBookChapters(RefreshBookChaptersCommand()))
    }

    func zoom(_ zoom: Double) {
        bridge.send(.setPrintZoom(SetPrintZoomCommand(zoom: zoom, fit: nil)))
    }

    func fit(_ fit: ZoomFit) {
        if fit == .actual { sendDisplayDensity() }
        bridge.send(.setPrintZoom(SetPrintZoomCommand(zoom: nil, fit: fit)))
    }

    func insertBreak(_ kind: PageBreakKind, target: EditorTarget?) {
        guard let target else { return }
        bridge.send(.insertBreak(InsertBreakCommand(target: target, kind: kind)))
    }

    func goToPage(_ page: Int) {
        bridge.send(.goToPage(GoToPageCommand(page: UInt32(max(1, page)))))
    }

    func print(_ scope: PrintScope, bound: Bool = false) {
        bridge.send(.printDocument(PrintDocumentCommand(scope: scope, bound: bound)))
    }

    func export(_ format: ExportFormat, scope: PrintScope, bound: Bool = false) {
        bridge.send(.exportDocument(ExportDocumentCommand(format: format, scope: scope, bound: bound)))
    }

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
            formatId: formatId)
    }

    /// Pick a size preset, keeping the orientation.
    mutating func choose(_ preset: PageSizeOption) {
        presetId = preset.id
        widthMm = preset.widthMm
        heightMm = preset.heightMm
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
                includeGuide: includeGuide))
    }
}

extension ClosedRange where Bound: Comparable {
    func clamped(_ value: Bound) -> Bound { Swift.min(Swift.max(value, lowerBound), upperBound) }
}
