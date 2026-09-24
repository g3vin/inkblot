import Foundation
import UniformTypeIdentifiers
import WebKit

/// Serves the page and the files it points at.
///
///  - `inkblot://app/…` is the built editor bundle, copied into the app as
///    `Resources/web` by the "Embed Web Bundle" phase. A custom scheme rather than
///    `loadFileURL`, because Vite emits `<script type="module" crossorigin>` and WebKit
///    refuses module scripts from `file://` — the page would load blank, with the
///    reason only in the Web Inspector.
///  - `asset://localhost/<percent-encoded absolute path>` is any file on disk: canvas
///    images and voice memos in a project's `.assets/`. It is the URL the shim's
///    `convertFileSrc` makes, which is the URL Tauri makes, so nothing in the bundle
///    had to change to reach it.
///
/// Byte ranges are honoured because `<audio>` asks for them, and a voice memo served
/// whole to a range request plays once and then refuses to seek.
final class AppSchemeHandler: NSObject, WKURLSchemeHandler {
    static let appScheme = "inkblot"
    static let assetScheme = "asset"
    static let appURL = URL(string: "inkblot://app/index.html")!

    private let webRoot: URL

    init(webRoot: URL) {
        self.webRoot = webRoot.standardizedFileURL
    }

    func webView(_ webView: WKWebView, start task: any WKURLSchemeTask) {
        guard let url = task.request.url, let file = resolve(url) else {
            respond(task, status: 404, body: Data("Not found".utf8), mime: "text/plain", url: task.request.url)
            return
        }

        guard let data = try? Data(contentsOf: file, options: .mappedIfSafe) else {
            respond(task, status: 404, body: Data("Not found".utf8), mime: "text/plain", url: url)
            return
        }

        let mime = Self.mimeType(for: file)
        if let range = task.request.value(forHTTPHeaderField: "Range"),
           let (start, end) = Self.parseRange(range, length: data.count) {
            respond(task, status: 206, body: data.subdata(in: start..<(end + 1)), mime: mime, url: url, extra: [
                "Content-Range": "bytes \(start)-\(end)/\(data.count)",
                "Accept-Ranges": "bytes",
            ])
        } else {
            respond(task, status: 200, body: data, mime: mime, url: url, extra: ["Accept-Ranges": "bytes"])
        }
    }

    func webView(_ webView: WKWebView, stop task: any WKURLSchemeTask) {
        // Every response is written synchronously in `start`, so there is never a task
        // in flight to cancel.
    }

    /* ---------------- resolving ---------------- */

    private func resolve(_ url: URL) -> URL? {
        switch url.scheme {
        case Self.appScheme:
            var path = url.path
            if path.isEmpty || path == "/" { path = "/index.html" }
            let candidate = webRoot.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
            // `..` in a URL must not walk out of the bundle.
            guard candidate.path.hasPrefix(webRoot.path + "/") else { return nil }
            if FileManager.default.fileExists(atPath: candidate.path) { return candidate }
            // A path with no extension is a client-side route, which is the page.
            return candidate.pathExtension.isEmpty ? webRoot.appendingPathComponent("index.html") : nil

        case Self.assetScheme:
            // `asset://localhost/%2FUsers%2F…` — the whole absolute path is one encoded
            // segment, so it is read off the raw string rather than out of `url.path`,
            // which would already have decoded the slashes and lost where it began.
            let prefix = "\(Self.assetScheme)://localhost/"
            let raw = url.absoluteString
            guard raw.hasPrefix(prefix) else { return nil }
            let encoded = String(raw.dropFirst(prefix.count)).components(separatedBy: "?")[0]
            guard let path = encoded.removingPercentEncoding, path.hasPrefix("/") else { return nil }
            return URL(fileURLWithPath: path)

        default:
            return nil
        }
    }

    /* ---------------- responding ---------------- */

    private func respond(
        _ task: any WKURLSchemeTask,
        status: Int,
        body: Data,
        mime: String,
        url: URL?,
        extra: [String: String] = [:]
    ) {
        var headers = [
            "Content-Type": mime,
            "Content-Length": String(body.count),
            // The page is `inkblot://app` and an asset is `asset://localhost`; a fetch()
            // of one from the other is cross-origin.
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-cache",
        ]
        headers.merge(extra) { _, new in new }
        let response = HTTPURLResponse(
            url: url ?? Self.appURL, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
        task.didReceive(response)
        task.didReceive(body)
        task.didFinish()
    }

    static func mimeType(for file: URL) -> String {
        switch file.pathExtension.lowercased() {
        // Neither has a UTType that maps to what a browser insists on: WebAssembly
        // streaming compilation checks for exactly application/wasm, and a module script
        // served as anything but JavaScript is refused.
        case "wasm": return "application/wasm"
        case "js", "mjs": return "text/javascript"
        default:
            return UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        }
    }

    /// `bytes=start-end`, `bytes=start-` or `bytes=-suffix`, clamped to the file.
    static func parseRange(_ header: String, length: Int) -> (Int, Int)? {
        guard length > 0, header.hasPrefix("bytes=") else { return nil }
        let spec = header.dropFirst("bytes=".count).split(separator: ",")[0]
        let parts = spec.split(separator: "-", omittingEmptySubsequences: false).map(String.init)
        guard parts.count == 2 else { return nil }
        if parts[0].isEmpty {
            guard let suffix = Int(parts[1]), suffix > 0 else { return nil }
            return (max(0, length - suffix), length - 1)
        }
        guard let start = Int(parts[0]), start < length else { return nil }
        let end = Int(parts[1]).map { min($0, length - 1) } ?? length - 1
        return end >= start ? (start, end) : nil
    }
}
