import Foundation
import os

/// `inkblot-models`, as the shell uses it: the synonym model, rhymes, Kokoro speech,
/// whisper dictation and the Pinterest scrape channel.
///
/// Two callers. `TauriHost` answers the page's `invoke` for those commands through
/// `invoke(_:args:)`, handing back exactly the JSON the Tauri app's command would have —
/// so `readAloud.js`, `dictation.js` and `pinterestScrape.js` run unchanged. And
/// `LanguageServices` calls the synonym and rhyme engines directly for the native
/// workbench tiles.
///
/// Every engine call blocks (a model load is seconds, a download minutes), so each runs
/// on a detached task, never on the main actor.
@MainActor
final class ModelService {
    static let shared = ModelService()

    /// Where model events go — the page's `listen('synonym://download', …)` and friends.
    /// Set by `EditorWebController` once the page exists.
    var emit: ((_ event: String, _ payloadJSON: String) -> Void)?

    private let models: InkblotModels?
    private let unavailable: String?
    private let log = Logger(subsystem: "inkblot", category: "models")

    struct Failure: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    private init() {
        let tokenizer = Bundle.main.url(forResource: "minilm-tokenizer", withExtension: "json")?.path ?? ""
        do {
            models = try InkblotModels(appDataRoot: CoreService.shared.appDataRoot.path, tokenizerPath: tokenizer)
            unavailable = nil
        } catch {
            models = nil
            unavailable = error.localizedDescription
            log.error("The models could not start: \(error.localizedDescription, privacy: .public)")
        }
    }

    /// The commands this answers, by the name the page invokes them with.
    static let commands: Set<String> = [
        "get_synonyms", "synonym_model_status", "download_synonym_model",
        "get_rhymes", "rhyme_dictionary_status", "download_rhyme_dictionary",
        "kokoro_vocab", "kokoro_model_status", "download_kokoro_model",
        "generate_kokoro_speech", "prewarm_kokoro_speech",
        "load_dictation_model", "start_dictation_session", "stop_dictation_session",
        "cancel_dictation_session", "dictation_status",
        "pinterest_begin_scrape", "pinterest_report_scrape", "pinterest_await_scrape",
    ]

    /// Run a blocking engine call off the main actor.
    private func run<T: Sendable>(_ body: @escaping @Sendable (InkblotModels) throws -> T) async throws -> T {
        guard let models else { throw Failure(message: unavailable ?? "The models are not available.") }
        return try await Task.detached(priority: .userInitiated) { try body(models) }.value
    }

    /// A sink that forwards to the page, from whichever thread Rust calls it on.
    private func sink() -> ModelEventSink {
        PageEventSink { event, payload in
            Task { @MainActor in ModelService.shared.emit?(event, payload) }
        }
    }

    /* ---------------- the page's invoke ---------------- */

    /// Answer one of `commands`. The result is the command's JSON, decoded, for
    /// `TauriHost` to hand back as the invoke's value.
    func invoke(_ cmd: String, args: [String: Any]) async throws -> Any? {
        let json: String?
        switch cmd {
        case "get_synonyms":
            let text = try Self.string(args, "text"), target = try Self.string(args, "targetWord")
            json = try await run { try $0.synonymsJson(text: text, targetWord: target) }
        case "synonym_model_status":
            json = try await run { try $0.synonymModelStatusJson() }
        case "download_synonym_model":
            let sink = sink()
            json = try await run { try $0.downloadSynonymModelJson(sink: sink) }

        case "get_rhymes":
            let word = try Self.string(args, "word")
            json = try await run { try $0.rhymesJson(word: word) }
        case "rhyme_dictionary_status":
            json = try await run { try $0.rhymeDictionaryStatusJson() }
        case "download_rhyme_dictionary":
            let sink = sink()
            json = try await run { try $0.downloadRhymeDictionaryJson(sink: sink) }

        case "kokoro_vocab":
            json = try await run { try $0.kokoroVocabJson() }
        case "kokoro_model_status":
            let voice = try Self.string(args, "voice")
            json = try await run { try $0.kokoroModelStatusJson(voice: voice) }
        case "download_kokoro_model":
            let voice = try Self.string(args, "voice"), sink = sink()
            json = try await run { try $0.downloadKokoroModelJson(voice: voice, sink: sink) }
        case "generate_kokoro_speech":
            let voice = try Self.string(args, "voice")
            let tokens = (args["tokens"] as? [NSNumber] ?? []).map(\.int64Value)
            let speed = (args["speed"] as? NSNumber)?.floatValue
            json = try await run { try $0.generateKokoroSpeechJson(tokens: tokens, voice: voice, speed: speed) }
        case "prewarm_kokoro_speech":
            let voice = try Self.string(args, "voice")
            try await run { try $0.prewarmKokoroSpeech(voice: voice) }
            json = nil

        case "load_dictation_model":
            let path = args["modelPath"] as? String
            json = try await run { try $0.loadDictationModelJson(modelPath: path) }
        case "start_dictation_session":
            let options = try (args["options"]).flatMap(Self.encode)
            let sink = sink()
            let sessionID = try await run { try $0.startDictationSession(optionsJson: options, sink: sink) }
            return sessionID
        case "stop_dictation_session":
            try await run { try $0.stopDictationSession() }
            json = nil
        case "cancel_dictation_session":
            try await run { $0.cancelDictationSession() }
            json = nil
        case "dictation_status":
            json = try await run { try $0.dictationStatusJson() }

        case "pinterest_begin_scrape":
            let id = try Self.string(args, "requestId")
            try await run { $0.pinterestBeginScrape(requestId: id) }
            json = nil
        case "pinterest_report_scrape":
            let report = try Self.encode(args["report"] as Any)
            try await run { try $0.pinterestReportScrape(reportJson: report) }
            json = nil
        case "pinterest_await_scrape":
            let id = try Self.string(args, "requestId")
            let timeout = (args["timeoutMs"] as? NSNumber)?.uint64Value ?? 15000
            json = try await run { try $0.pinterestAwaitScrapeJson(requestId: id, timeoutMs: timeout) }

        default:
            throw Failure(message: "\(cmd) is not a model command")
        }
        return try json.map(Self.decode)
    }

    /* ---------------- the native workbench ---------------- */

    func synonyms(text: String, target: String) async throws -> [String] {
        let json = try await run { try $0.synonymsJson(text: text, targetWord: target) }
        return (try Self.decode(json) as? [String: Any])?["synonyms"] as? [String] ?? []
    }

    func downloadSynonymModel() async throws {
        let sink = sink()
        _ = try await run { try $0.downloadSynonymModelJson(sink: sink) }
    }

    func rhymes(for word: String) async throws -> [String] {
        let json = try await run { try $0.rhymesJson(word: word) }
        return (try Self.decode(json) as? [String: Any])?["rhymes"] as? [String] ?? []
    }

    func downloadRhymeDictionary() async throws {
        let sink = sink()
        _ = try await run { try $0.downloadRhymeDictionaryJson(sink: sink) }
    }

    /* ---------------- JSON ---------------- */

    private static func string(_ args: [String: Any], _ key: String) throws -> String {
        guard let value = args[key] as? String else { throw Failure(message: "Missing \(key)") }
        return value
    }

    private static func encode(_ value: Any) throws -> String {
        guard !(value is NSNull) else { return "null" }
        let data = try JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed])
        return String(decoding: data, as: UTF8.self)
    }

    private static func decode(_ json: String) throws -> Any {
        try JSONSerialization.jsonObject(with: Data(json.utf8), options: [.fragmentsAllowed])
    }
}

/// `ModelEventSink`, for UniFFI to call from Rust's threads.
private final class PageEventSink: ModelEventSink, @unchecked Sendable {
    private let forward: @Sendable (String, String) -> Void

    nonisolated init(_ forward: @escaping @Sendable (String, String) -> Void) {
        self.forward = forward
    }

    nonisolated func emit(event: String, payloadJson: String) {
        forward(event, payloadJson)
    }
}
