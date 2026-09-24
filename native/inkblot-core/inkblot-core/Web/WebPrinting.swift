import AppKit
import WebKit

/// Printing the page on paper of an exact size.
///
/// By the time a `printRequest` arrives the page has laid out every sheet at its real
/// size in `#print-root`, and its print stylesheet shows nothing else. So the print
/// here must add nothing of its own: the paper is the size asked for, the margins are
/// zero, and nothing is scaled to fit — or every page would shrink onto a default
/// Letter page with an inch of margin around it.
///
/// A PDF is the same operation saving instead of printing: a real multi-page PDF at the
/// page size, which `createPDF` (one tall page) cannot give.
extension EditorWebController {
    func print(_ request: PrintRequest, completion: @escaping (Bool) -> Void) {
        let info = (NSPrintInfo.shared.copy() as? NSPrintInfo) ?? NSPrintInfo()
        info.paperSize = NSSize(width: request.paperWidthPt, height: request.paperHeightPt)
        // Must agree with the paper, or AppKit rotates the job.
        info.orientation = request.paperWidthPt > request.paperHeightPt ? .landscape : .portrait
        info.topMargin = 0
        info.bottomMargin = 0
        info.leftMargin = 0
        info.rightMargin = 0
        info.horizontalPagination = .clip
        info.verticalPagination = .automatic
        info.isHorizontallyCentered = false
        info.isVerticallyCentered = false
        info.scalingFactor = 1

        if let path = request.pdfPath {
            info.jobDisposition = .save
            info.dictionary()[NSPrintInfo.AttributeKey.jobSavingURL] = URL(fileURLWithPath: path)
        }

        let operation = webView.printOperation(with: info)
        operation.jobTitle = request.jobName
        operation.showsPrintPanel = request.pdfPath == nil
        operation.showsProgressPanel = true
        // A WKWebView renders a print asynchronously: a synchronous `run()` prints blank
        // pages. The window-modal form waits for it, and says when it is done.
        operation.view?.frame = webView.bounds

        guard let window = webView.window else {
            completion(operation.run())
            return
        }
        let delegate = PrintCompletion(completion)
        operation.runModal(
            for: window,
            delegate: delegate,
            didRun: #selector(PrintCompletion.printOperationDidRun(_:success:contextInfo:)),
            contextInfo: Unmanaged.passRetained(delegate).toOpaque())
    }
}

/// The target `runModal` calls back. It keeps itself alive through the context
/// pointer until then, because nothing else holds it.
private final class PrintCompletion: NSObject {
    private let completion: (Bool) -> Void

    init(_ completion: @escaping (Bool) -> Void) {
        self.completion = completion
    }

    @objc func printOperationDidRun(_ operation: NSPrintOperation, success: Bool, contextInfo: UnsafeMutableRawPointer?) {
        if let contextInfo { Unmanaged<PrintCompletion>.fromOpaque(contextInfo).release() }
        completion(success)
    }
}
