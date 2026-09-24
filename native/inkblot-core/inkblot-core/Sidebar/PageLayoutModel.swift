import AppKit
import Observation

/// Print Layout, as the shell sees it: the inspector's Page tab and the File and View
/// menus' print items.
///
/// The page owns every part of it. A document's page setup lives on its doc node, so
/// only the page can change it without racing autosave; the book settings live in
/// preferences the page hydrates. The page publishes `pageLayoutState` and this model
/// edits by command — see `bridge/print.rs`.
@MainActor
@Observable
final class PageLayoutModel {
    private(set) var state: PageLayoutState?

    @ObservationIgnored private let bridge: ShellBridge
    @ObservationIgnored private var screenObserver: NSObjectProtocol?

    init(bridge: ShellBridge) {
        self.bridge = bridge
        bridge.addListener { [weak self] event in
            guard let self else { return }
            if case .pageLayoutState(let next) = event { state = next }
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

    /* ---------------- commands ---------------- */

    func setPrintLayout(_ enabled: Bool) {
        bridge.send(.setPrintLayout(SetPrintLayoutCommand(enabled: enabled)))
        if enabled { sendDisplayDensity() }
    }

    func apply(_ draft: PageSetupDraft) {
        bridge.send(.setPageSetup(SetPageSetupCommand(setup: draft.setup)))
    }

    func apply(_ draft: BookDraft) {
        bridge.send(.setBookSettings(SetBookSettingsCommand(settings: draft.settings)))
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
}

/* ---------------- editable copies ---------------- */

// The generated types are immutable, as a protocol's values should be. The Page tab
// edits one of these and sends the whole value back.

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
            headerDistanceMm: headerDistanceMm,
            footerDistanceMm: footerDistanceMm,
            differentFirstPage: differentFirstPage,
            pageNumberStart: UInt32(max(0, pageNumberStart)),
            pageNumberFormat: pageNumberFormat,
            widowOrphanLines: UInt32(max(1, min(5, widowOrphanLines))),
            chapterStartsOnRecto: chapterStartsOnRecto)
    }

    /// Pick a size preset, keeping the orientation.
    mutating func choose(_ preset: PageSizeOption) {
        presetId = preset.id
        widthMm = preset.widthMm
        heightMm = preset.heightMm
    }

    /// Typical book settings for the current trim size.
    mutating func makeBook() {
        mirrorMargins = true
        if gutterMm < 3 { gutterMm = 3.175 }
        header = RunningTextDraft(RunningText(left: "", center: "{chapter}", right: ""))
        versoDiffers = true
        versoHeader = RunningTextDraft(RunningText(left: "", center: "{title}", right: ""))
        versoFooter = footer
        differentFirstPage = true
        chapterStartsOnRecto = true
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
                paperThicknessMm: paperThicknessMm,
                cropMarks: cropMarks,
                includeGuide: includeGuide))
    }
}
