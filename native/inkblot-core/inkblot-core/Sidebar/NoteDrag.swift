import Foundation

/// What a note dragged out of the native Notes panel carries: a URL naming the note,
/// which WebKit hands the page as `text/uri-list` on an ordinary drop. The page's side
/// is `noteDragURL` in `src/canvas/canvasEvents.js`; the two spell the format the same.
enum NoteDrag {
    static let scheme = "inkblot-note"

    static func url(docPath: String?, noteId: String) -> URL? {
        guard let docPath, !docPath.isEmpty, !noteId.isEmpty else { return nil }
        var components = URLComponents()
        components.scheme = scheme
        components.host = "note"
        components.queryItems = [
            URLQueryItem(name: "doc", value: docPath),
            URLQueryItem(name: "id", value: noteId),
        ]
        return components.url
    }
}
