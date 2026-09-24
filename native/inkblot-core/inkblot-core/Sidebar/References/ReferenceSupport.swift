import AppKit
import Foundation
import SwiftUI

/* ---------------- patches ---------------- */

extension ReferencePatch {
    /// A patch that changes only what is given — the generated initializer wants every
    /// field spelled out.
    static func with(
        kind: String? = nil,
        contributors: [Contributor]? = nil,
        fields: [String: String]? = nil,
        annotation: String? = nil,
        note: String? = nil,
        tags: [String]? = nil
    ) -> ReferencePatch {
        ReferencePatch(kind: kind, contributors: contributors, fields: fields, annotation: annotation, note: note, tags: tags)
    }
}

/// `BibliographyOptions`, mutable, for `SidebarModel.setBibliographyOptions`.
struct BibliographyEdit {
    var include: BibliographyInclude
    var annotated: Bool
    var inPrint: Bool
    var title: String?

    init(_ options: BibliographyOptions) {
        include = options.include
        annotated = options.annotated
        inPrint = options.inPrint
        title = options.title
    }

    var options: BibliographyOptions {
        BibliographyOptions(include: include, annotated: annotated, inPrint: inPrint, title: title)
    }
}

/* ---------------- names ---------------- */

extension Contributor {
    var isOrganization: Bool { literal != nil }

    /// "Jane Austen", or the organisation.
    var displayName: String {
        literal ?? [given, family].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
    }
}

extension Reference {
    var title: String { fields["title"] ?? "" }

    /// "Austen · 2003", for the compact places a whole entry does not fit.
    var byline: String {
        let people = contributors.prefix(2).map { $0.literal ?? $0.family ?? $0.displayName }.filter { !$0.isEmpty }
        let who = people.joined(separator: ", ") + (contributors.count > 2 ? " et al." : "")
        let year = fields["issued"].map { String($0.prefix(4)) } ?? ""
        return [who, year].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    var sourceURL: URL? {
        if let url = fields["URL"].flatMap(URL.init(string:)), url.scheme?.hasPrefix("http") == true { return url }
        if let doi = fields["DOI"], !doi.isEmpty { return URL(string: "https://doi.org/\(doi)") }
        return nil
    }
}

/* ---------------- formatted entries ---------------- */

/// A formatted entry from the page — HTML with only `i`, `b`, `sup`, `sub` and
/// `span.sc` in it (`format.js` `tidy`) — as an `AttributedString`.
enum ReferenceText {
    static func attributed(_ html: String, font: Font = .callout) -> AttributedString {
        var out = AttributedString()
        var italic = 0, bold = 0, sup = 0, sub = 0, smallCaps = 0
        var index = html.startIndex

        func append(_ raw: Substring) {
            guard !raw.isEmpty else { return }
            var run = AttributedString(decodeEntities(String(raw)))
            var runFont = font
            if italic > 0 { runFont = runFont.italic() }
            if bold > 0 { runFont = runFont.bold() }
            if smallCaps > 0 { runFont = runFont.lowercaseSmallCaps() }
            if sup > 0 || sub > 0 {
                runFont = .caption2
                run.baselineOffset = sup > 0 ? 5 : -3
            }
            run.font = runFont
            out.append(run)
        }

        while index < html.endIndex {
            guard let open = html[index...].firstIndex(of: "<") else {
                append(html[index...])
                break
            }
            append(html[index..<open])
            guard let close = html[open...].firstIndex(of: ">") else {
                append(html[open...])
                break
            }
            let tag = html[html.index(after: open)..<close].lowercased()
            let closing = tag.hasPrefix("/")
            let name = String(tag.drop { $0 == "/" }.prefix { $0.isLetter })
            let delta = closing ? -1 : 1
            switch name {
            case "i", "em": italic = max(0, italic + delta)
            case "b", "strong": bold = max(0, bold + delta)
            case "sup": sup = max(0, sup + delta)
            case "sub": sub = max(0, sub + delta)
            case "span":
                if closing { smallCaps = max(0, smallCaps - 1) } else if tag.contains("sc") { smallCaps += 1 }
            default: break
            }
            index = html.index(after: close)
        }
        return out
    }

    static func plain(_ html: String) -> String {
        decodeEntities(html.replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression))
    }

    static func decodeEntities(_ text: String) -> String {
        guard text.contains("&") else { return text }
        var out = text
        for (entity, value) in [("&lt;", "<"), ("&gt;", ">"), ("&quot;", "\""), ("&#39;", "'"), ("&nbsp;", "\u{00a0}")] {
            out = out.replacingOccurrences(of: entity, with: value)
        }
        if let regex = try? NSRegularExpression(pattern: "&#(x?)([0-9a-fA-F]+);") {
            let ns = out as NSString
            var result = ""
            var last = 0
            for match in regex.matches(in: out, range: NSRange(location: 0, length: ns.length)) {
                result += ns.substring(with: NSRange(location: last, length: match.range.location - last))
                let hex = ns.substring(with: match.range(at: 1)) == "x"
                let digits = ns.substring(with: match.range(at: 2))
                if let code = UInt32(digits, radix: hex ? 16 : 10), let scalar = Unicode.Scalar(code) {
                    result.unicodeScalars.append(scalar)
                } else {
                    result += ns.substring(with: match.range)
                }
                last = match.range.location + match.range.length
            }
            result += ns.substring(from: last)
            out = result
        }
        return out.replacingOccurrences(of: "&amp;", with: "&")
    }

    /// The entry as rich text on the pasteboard, for pasting into another app.
    static func copy(html: String, plain: String) {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        let body = "<meta charset=\"utf-8\"><span style=\"font-family: -apple-system\">\(html.replacingOccurrences(of: "class=\"sc\"", with: "style=\"font-variant: small-caps\""))</span>"
        if let data = body.data(using: .utf8),
           let rich = try? NSAttributedString(data: data, options: [.documentType: NSAttributedString.DocumentType.html, .characterEncoding: String.Encoding.utf8.rawValue], documentAttributes: nil),
           let rtf = try? rich.data(from: NSRange(location: 0, length: rich.length), documentAttributes: [.documentType: NSAttributedString.DocumentType.rtf]) {
            pasteboard.setData(rtf, forType: .rtf)
        }
        pasteboard.setString(body, forType: .html)
        pasteboard.setString(plain, forType: .string)
    }
}
