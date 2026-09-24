import NaturalLanguage
import SwiftUI

/// The Workbench tab: language tools made from a selection by the editor's context
/// menu. The tiles are the page's (it made them, and it holds the anchor each one's
/// word is found by); what a tile *shows* is computed here.
struct WorkbenchPanelView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let sidebar = model.sidebar
        let tiles = sidebar.tiles.filter { sidebar.matchesFilter($0.type.rawValue, $0.text, $0.doc ?? "") }

        VStack(spacing: 0) {
            if !sidebar.tiles.isEmpty {
                HStack {
                    Spacer()
                    Button("Clear All") { sidebar.removeTiles(nil) }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
            }
            if tiles.isEmpty {
                ContentUnavailableView {
                    Text(sidebar.tiles.isEmpty ? "Workbench Is Empty" : "No Matching Tiles")
                } description: {
                    Text(sidebar.tiles.isEmpty
                        ? "Select text in the document and choose a language tool from its menu."
                        : "")
                }
                .frame(maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(spacing: 10) {
                        ForEach(tiles, id: \.id) { tile in
                            TileCard(tile: tile)
                        }
                    }
                    .padding(12)
                }
            }
        }
    }
}

private struct TileCard: View {
    @Environment(AppModel.self) private var model
    let tile: WorkbenchTile

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(eyebrow).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                Spacer()
                Button { model.sidebar.removeTiles([tile.id]) } label: { Image(systemName: "trash") }
                    .buttonStyle(.borderless)
                    .help("Remove tile")
            }
            switch tile.type {
            case .pos: PartsOfSpeechView(sentence: tile.text)
            case .definition: DefinitionView(word: tile.text)
            case .synonym: SynonymsView(tile: tile)
            case .rhyme: RhymesView(tile: tile)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12).fill(.background.secondary))
    }

    private var eyebrow: String {
        switch tile.type {
        case .pos: "Parts of Speech"
        case .definition: "Dictionary"
        case .synonym: "Synonyms"
        case .rhyme: "Rhymes"
        }
    }
}

/* ---------------- parts of speech ---------------- */

/// Tagged with the system's own tagger rather than a bundled NLP library — and mapped
/// onto the same ten categories and colours the page's tile used.
struct PartsOfSpeechView: View {
    let sentence: String

    struct Token: Identifiable {
        let id: Int
        let text: String
        let category: String
    }

    static let colors: [String: Color] = [
        "Noun": Color(hex: "#1f77b4")!, "Verb": Color(hex: "#2ca02c")!,
        "Adjective": Color(hex: "#ff7f0e")!, "Adverb": Color(hex: "#d62728")!,
        "Number": Color(hex: "#17becf")!, "Pronoun": Color(hex: "#9467bd")!,
        "Determiner": Color(hex: "#8c564b")!, "Conjunction": Color(hex: "#e377c2")!,
        "Preposition": Color(hex: "#7f7f7f")!, "Unknown": Color(hex: "#cccccc")!,
    ]

    static func tag(_ sentence: String) -> [Token] {
        let tagger = NLTagger(tagSchemes: [.lexicalClass])
        tagger.string = sentence
        var tokens: [Token] = []
        tagger.enumerateTags(in: sentence.startIndex..<sentence.endIndex, unit: .word,
                             scheme: .lexicalClass, options: [.omitWhitespace, .omitPunctuation]) { tag, range in
            let category: String = switch tag {
            case .noun, .personalName, .placeName, .organizationName: "Noun"
            case .verb: "Verb"
            case .adjective: "Adjective"
            case .adverb: "Adverb"
            case .number: "Number"
            case .pronoun: "Pronoun"
            case .determiner: "Determiner"
            case .conjunction: "Conjunction"
            case .preposition, .particle: "Preposition"
            default: "Unknown"
            }
            tokens.append(Token(id: tokens.count, text: String(sentence[range]), category: category))
            return true
        }
        return tokens
    }

    var body: some View {
        FlowLayout(spacing: 6) {
            ForEach(Self.tag(sentence)) { token in
                VStack(spacing: 2) {
                    Text(token.category)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .background(Capsule().fill(Self.colors[token.category] ?? .gray))
                    Text(token.text).font(.callout)
                }
            }
        }
    }
}

/* ---------------- definition ---------------- */

/// The first sense from the same free dictionary API the page's tile used, so the two
/// shells define a word the same way.
struct DefinitionView: View {
    let word: String
    @State private var state: LookupState = .loading

    enum LookupState: Equatable {
        case loading
        case found(partOfSpeech: String, text: String)
        case missing
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(word.lowercased()).font(.title3.weight(.semibold))
            switch state {
            case .loading: Text("Looking up…").foregroundStyle(.secondary)
            case .missing: Text("No definition found.").foregroundStyle(.secondary)
            case .found(let pos, let text):
                if !pos.isEmpty { Text("(\(pos).)").font(.callout.italic()).foregroundStyle(.secondary) }
                Text(text).textSelection(.enabled)
            }
        }
        .task(id: word) { state = await Self.lookUp(word) }
    }

    private struct Entry: Decodable {
        struct Meaning: Decodable {
            struct Sense: Decodable { let definition: String? }
            let partOfSpeech: String?
            let definitions: [Sense]?
        }
        let meanings: [Meaning]?
    }

    static func lookUp(_ word: String) async -> LookupState {
        let encoded = word.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? word
        guard let url = URL(string: "https://api.dictionaryapi.dev/api/v2/entries/en/\(encoded)"),
              let (data, response) = try? await URLSession.shared.data(from: url),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let entries = try? JSONDecoder().decode([Entry].self, from: data),
              let meaning = entries.first?.meanings?.first,
              let definition = meaning.definitions?.first?.definition
        else { return .missing }
        return .found(partOfSpeech: meaning.partOfSpeech ?? "", text: definition)
    }
}

/* ---------------- synonyms and rhymes ---------------- */

struct SynonymsView: View {
    @Environment(AppModel.self) private var model
    let tile: WorkbenchTile
    @State private var state: WordListState = .loading

    var body: some View {
        WordListView(tile: tile, state: state, emptyText: "No synonyms found.")
            .task(id: tile.text) {
                do {
                    state = .words(try await model.language.synonyms(for: tile.text))
                } catch {
                    state = .failed(error.localizedDescription)
                }
            }
    }
}

struct RhymesView: View {
    @Environment(AppModel.self) private var model
    let tile: WorkbenchTile
    @State private var state: WordListState = .loading

    var body: some View {
        WordListView(tile: tile, state: state, emptyText: "No rhymes found.")
            .task(id: tile.text) {
                do {
                    state = .words(try await model.language.rhymes(for: tile.text))
                } catch {
                    state = .failed(error.localizedDescription)
                }
            }
    }
}

enum WordListState {
    case loading
    case words([String])
    case failed(String)
}

/// Words that can replace the tile's word: a click replaces it in the document (the
/// page finds the word by its anchor), and the tile's own word selects it there.
private struct WordListView: View {
    @Environment(AppModel.self) private var model
    let tile: WorkbenchTile
    let state: WordListState
    let emptyText: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button { model.sidebar.selectWord(of: tile) } label: {
                Text(tile.text).font(.title3.weight(.semibold))
            }
            .buttonStyle(.plain)
            .help("Select in the document")

            switch state {
            case .loading:
                ProgressView().controlSize(.small)
            case .failed(let message):
                Text(message).font(.callout).foregroundStyle(.secondary)
            case .words(let words) where words.isEmpty:
                Text(emptyText).font(.callout).foregroundStyle(.secondary)
            case .words(let words):
                FlowLayout(spacing: 6) {
                    ForEach(words, id: \.self) { word in
                        Button(word) { model.sidebar.replaceWord(of: tile, with: word) }
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                            .help("Replace “\(tile.text)” with “\(word)”")
                    }
                }
            }
        }
    }
}

/* ---------------- layout ---------------- */

/// Left-to-right, wrapping — tags and word chips.
struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, widest: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width {
                y += rowHeight + spacing
                x = 0
                rowHeight = 0
            }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
            widest = max(widest, x - spacing)
        }
        return CGSize(width: min(widest, width), height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                y += rowHeight + spacing
                x = bounds.minX
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}
