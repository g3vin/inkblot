import Foundation

/// The language models behind the workbench's synonym and rhyme tiles.
///
/// A seam, deliberately: the models are Rust (`ort` + `tokenizers`), and until they
/// live in a crate `inkblot-ffi` can link, there is nothing on this side to call. The
/// tiles are written against this, so wiring the models in changes one file.
@MainActor
final class LanguageServices {
    struct Unavailable: LocalizedError {
        let what: String
        var errorDescription: String? { "\(what) aren’t available in the native app yet." }
    }

    func synonyms(for word: String) async throws -> [String] {
        throw Unavailable(what: "Synonyms")
    }

    func rhymes(for word: String) async throws -> [String] {
        throw Unavailable(what: "Rhymes")
    }
}
