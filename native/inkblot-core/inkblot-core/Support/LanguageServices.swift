import Foundation

/// The language models behind the workbench's synonym and rhyme tiles.
///
/// A seam the tiles are written against: the models are Rust (`inkblot-models`, reached
/// through `ModelService`), and this is where their sentinels become errors a tile can
/// show and act on.
@MainActor
final class LanguageServices {
    private let models: ModelService

    init(models: ModelService? = nil) {
        self.models = models ?? .shared
    }

    /// The model is not on disk yet. The tile offers the download.
    struct NotInstalled: LocalizedError {
        let what: String
        let size: String
        var errorDescription: String? { "The \(what) (\(size)) downloads once, then works offline." }
    }

    private static func isNotInstalled(_ error: Error) -> Bool {
        error.localizedDescription.contains("MODEL_NOT_INSTALLED")
    }

    /// Synonyms for `word`, filtered the way `SynonymTile` filters them: no repeats, and
    /// nothing that merely contains the word.
    func synonyms(for word: String) async throws -> [String] {
        let target = word.trimmingCharacters(in: .whitespaces).lowercased()
        do {
            let raw = try await models.synonyms(text: "I am \(target).", target: target)
            var seen = Set<String>()
            return raw.filter { candidate in
                let normal = candidate.trimmingCharacters(in: .whitespaces).lowercased()
                guard !normal.isEmpty, !normal.contains(target) else { return false }
                return seen.insert(normal).inserted
            }
        } catch where Self.isNotInstalled(error) {
            throw NotInstalled(what: "synonym model", size: "423 MB")
        }
    }

    func downloadSynonymModel() async throws {
        try await models.downloadSynonymModel()
    }

    /// Rhymes for `word`. The dictionary is 3.6 MB, so it is fetched without asking.
    func rhymes(for word: String) async throws -> [String] {
        do {
            return try await models.rhymes(for: word)
        } catch where Self.isNotInstalled(error) {
            try await models.downloadRhymeDictionary()
            return try await models.rhymes(for: word)
        }
    }
}
