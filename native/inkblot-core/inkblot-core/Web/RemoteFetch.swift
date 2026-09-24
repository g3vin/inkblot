import Foundation

/// A GET on the page's behalf, for looking a source up (`references/fetchText.js`).
///
/// The page cannot fetch another origin, so the References panel's lookups — a web
/// page's metadata, doi.org, Open Library, arXiv, PubMed — come through here. Only
/// http(s), only GET, and only so much of the body: a lookup reads a page's head, not
/// its video.
enum RemoteFetch {
    static let maxBytes = 5 * 1024 * 1024
    static let timeout: TimeInterval = 15
    /// Sites answer a browser-like agent with the page a reader sees, metadata and all.
    static let userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15 Inkblot"

    struct Failure: LocalizedError {
        let errorDescription: String?
        init(_ message: String) { errorDescription = message }
    }

    private static let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = timeout
        configuration.timeoutIntervalForResource = timeout * 2
        configuration.httpAdditionalHeaders = ["User-Agent": userAgent]
        return URLSession(configuration: configuration)
    }()

    /// `{ status, finalUrl, contentType, body }`, the shape `fetchText.js` expects.
    static func text(url raw: String, accept: String?) async throws -> [String: Any] {
        guard let url = URL(string: raw), let scheme = url.scheme?.lowercased(), ["http", "https"].contains(scheme) else {
            throw Failure("Only web addresses can be looked up")
        }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        if let accept, !accept.isEmpty { request.setValue(accept, forHTTPHeaderField: "Accept") }
        request.setValue("en-US,en;q=0.9", forHTTPHeaderField: "Accept-Language")

        let (bytes, response) = try await session.bytes(for: request)
        var data = Data()
        for try await byte in bytes {
            data.append(byte)
            if data.count >= maxBytes { break }
        }
        let http = response as? HTTPURLResponse
        let contentType = http?.value(forHTTPHeaderField: "Content-Type") ?? ""
        return [
            "status": http?.statusCode ?? 0,
            "finalUrl": response.url?.absoluteString ?? raw,
            "contentType": contentType,
            "body": decode(data, contentType: contentType),
        ]
    }

    /// The charset the server named, else UTF-8, else Latin-1 (which never fails).
    private static func decode(_ data: Data, contentType: String) -> String {
        if let range = contentType.range(of: "charset=", options: .caseInsensitive) {
            let name = contentType[range.upperBound...].split(separator: ";").first.map(String.init)?
                .trimmingCharacters(in: CharacterSet(charactersIn: "\" ")) ?? ""
            let encoding = CFStringConvertEncodingToNSStringEncoding(CFStringConvertIANACharSetNameToEncoding(name as CFString))
            if encoding != UInt(kCFStringEncodingInvalidId), let text = String(data: data, encoding: String.Encoding(rawValue: encoding)) {
                return text
            }
        }
        return String(data: data, encoding: .utf8) ?? String(decoding: data, as: UTF8.self)
    }
}
