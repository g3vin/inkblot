import Foundation

/// What a bubble session does to a sentence — a port of the page's `lib/bubbleText.ts`,
/// which the Tauri app's editor uses. The two must split and join the same way: a session
/// arranged in one shell is reopened in the other. `BubbleTextTests` holds the same cases
/// as the page's `bubble` suite.
///
/// Punctuation is its own bubble, and a sentence is put back together by `joinTokens`:
/// no space before a comma or a closing quote, none after an opening one. Capitals that
/// only mark a sentence's start are left off the bubbles and put back by `compose` where
/// sentences now begin. Taking them off happens only in the page, which is where sessions
/// are made, so only putting them back is ported here.
enum BubbleText {
    static func newId(_ prefix: String = "w") -> String {
        "\(prefix)-\(UUID().uuidString.prefix(13).lowercased())"
    }

    /// The chunks of some text between whitespace.
    static func splitWords(_ text: String) -> [String] {
        text.split(whereSeparator: \.isWhitespace).map(String.init)
    }

    /* ---------------- tokens ---------------- */

    /// Punctuation that comes off either end of a word. Single quotes are handled apart:
    /// they are apostrophes as often as quotes.
    private static let peeled = Set(".,;:!?\"“”()[]{}…—–")
    private static let grouped: Set<Character> = [".", "!", "?"]
    private static let opening: Set<String> = ["(", "[", "{", "“", "‘"]
    private static let closing: Set<String> = [")", "]", "}", "”", "’"]
    private static let abbreviations: Set<String> = ["mr", "mrs", "ms", "dr", "st", "jr", "sr", "prof", "vs", "etc", "no", "mt"]

    /// Whether a bubble is punctuation only — drawn as a small round bubble.
    static func isPunctuation(_ text: String) -> Bool {
        !text.isEmpty && !text.contains { $0.isLetter || $0.isNumber }
    }

    private static func groupRun(_ chars: [Character]) -> [String] {
        var out: [String] = []
        for char in chars {
            if let last = out.last, grouped.contains(char), last.allSatisfy(grouped.contains) {
                out[out.count - 1] = last + String(char)
            } else {
                out.append(String(char))
            }
        }
        return out
    }

    /// Words and punctuation, in order.
    static func tokenize(_ text: String) -> [String] {
        var tokens: [String] = []
        // A single quote opened earlier: a trailing ' or ’ closes it rather than being a
        // possessive apostrophe.
        var singleOpen = false
        for chunk in splitWords(text) {
            let chars = Array(chunk)
            var start = 0
            var end = chars.count
            var lead: [Character] = []
            var trail: [Character] = []
            while start < end, peeled.contains(chars[start]) || chars[start] == "'" || chars[start] == "‘" {
                if chars[start] == "'" || chars[start] == "‘" { singleOpen = true }
                lead.append(chars[start])
                start += 1
            }
            while end > start {
                let char = chars[end - 1]
                let quote = char == "'" || char == "’"
                guard peeled.contains(char) || (quote && singleOpen) else { break }
                // A single final period that belongs to an abbreviation stays on it.
                if char == ".", trail.isEmpty, end < 2 || chars[end - 2] != "." {
                    let core = String(chars[start..<(end - 1)])
                    if core.contains(".") || abbreviations.contains(core.lowercased()) { break }
                }
                if quote { singleOpen = false }
                trail.insert(char, at: 0)
                end -= 1
            }
            tokens += groupRun(lead)
            if start < end { tokens.append(String(chars[start..<end])) }
            tokens += groupRun(trail)
        }
        return tokens
    }

    private enum Role { case word, open, close, tight, neutral }

    /// What each token does to the spaces around it. Straight quotes alternate open, close.
    private static func roles(_ tokens: [String]) -> [Role] {
        var doubleOpen = false
        var singleOpen = false
        return tokens.enumerated().map { index, token in
            guard isPunctuation(token) else { return .word }
            if token == "\"" || token == "'" {
                let open = token == "\"" ? doubleOpen : singleOpen
                // A quote with nothing after it closes, whatever the count says.
                let closes = open || (index == tokens.count - 1 && index > 0)
                if token == "\"" { doubleOpen = !closes } else { singleOpen = !closes }
                return closes ? .close : .open
            }
            if opening.contains(token) { return .open }
            if closing.contains(token) { return .close }
            if let first = token.first, ".,;:!?…".contains(first) { return .tight }
            return .neutral
        }
    }

    /// Which word tokens begin a sentence. A ! or ? closed by a quote is dialogue and does
    /// not end the sentence.
    private static func sentenceStarts(_ tokens: [String], _ roles: [Role], startsSentence: Bool) -> Set<Int> {
        var starts: Set<Int> = []
        var next = startsSentence
        var lastTerminal = ""
        for (index, token) in tokens.enumerated() {
            let role = roles[index]
            if role == .word {
                if next { starts.insert(index) }
                next = false
                lastTerminal = ""
            } else if token.allSatisfy(grouped.contains) {
                next = true
                lastTerminal = token
            } else if role == .close, let last = lastTerminal.last, last == "!" || last == "?" {
                next = false
            }
        }
        return starts
    }

    /// Whether the text begins with a capital — which says whether it begins a sentence.
    static func startsCapitalized(_ text: String) -> Bool {
        guard let first = text.first(where: \.isLetter) else { return false }
        return first.isUppercase
    }

    /// Tokens put back together. `startsSentence` capitalizes each sentence's first word;
    /// `nil` leaves the words as they are.
    static func joinTokens(_ tokens: [String], startsSentence: Bool? = nil) -> String {
        let roles = roles(tokens)
        let starts = startsSentence.map { sentenceStarts(tokens, roles, startsSentence: $0) } ?? []
        var out = ""
        for (index, token) in tokens.enumerated() {
            let role = roles[index]
            let previous: Role? = index > 0 ? roles[index - 1] : nil
            if !out.isEmpty, role != .close, role != .tight, previous != .open { out += " " }
            out += starts.contains(index) ? token.prefix(1).uppercased() + token.dropFirst() : token
        }
        return out
    }

    /* ---------------- clauses ---------------- */

    /// Words that usually begin a new clause. "and", "or" and "that" are left out: they
    /// join nouns as often as clauses, and a comma before them already splits.
    static let clauseOpeners: Set<String> = [
        "but", "because", "although", "though", "while", "whereas", "when", "whenever",
        "where", "wherever", "unless", "until", "since", "which", "who", "whom", "whose", "if",
    ]
    private static let clauseEnd: Set<String> = [",", ";", ":", "—", "–"]

    /// Tokens grouped into sentences. A sentence begins at each word `sentenceStarts` says
    /// begins one, and takes with it the opening quotes or brackets just before it.
    private static func groupSentences(_ tokens: [String]) -> [[String]] {
        let roles = roles(tokens)
        let starts = sentenceStarts(tokens, roles, startsSentence: true)
        var sentences: [[String]] = []
        var begin = 0
        var sawWord = false
        for index in tokens.indices {
            if starts.contains(index), sawWord {
                var end = index
                while end > begin, roles[end - 1] == .open { end -= 1 }
                sentences.append(Array(tokens[begin..<end]))
                begin = end
            }
            if roles[index] == .word { sawWord = true }
        }
        if begin < tokens.count { sentences.append(Array(tokens[begin...])) }
        return sentences
    }

    /// Tokens grouped into clauses, within sentences: a break at each sentence's end, after
    /// a comma, semicolon, colon or dash, and before a subordinating word once the clause
    /// has two words in it. A closing quote or bracket stays with the clause it closes.
    private static func groupClauses(_ tokens: [String]) -> [[String]] {
        let roles = roles(tokens)
        var clauses: [[String]] = []
        var offset = 0
        for sentence in groupSentences(tokens) {
            var current: [String] = []
            var words = 0
            func flush() {
                if !current.isEmpty { clauses.append(current) }
                current = []
                words = 0
            }
            for (at, token) in sentence.enumerated() {
                let role = roles[offset + at]
                if role == .close, current.isEmpty, !clauses.isEmpty {
                    clauses[clauses.count - 1].append(token)
                    continue
                }
                if role == .word, words >= 2, clauseOpeners.contains(token.lowercased()) { flush() }
                current.append(token)
                if role == .word { words += 1 }
                if clauseEnd.contains(token) { flush() }
            }
            flush()
            offset += sentence.count
        }
        return clauses.flatMap { detachPunctuation($0) }
    }

    /// A clause with the marks at either end split off, one group each — so a comma or a
    /// closing quote can be moved apart from the words.
    private static func detachPunctuation(_ clause: [String]) -> [[String]] {
        var start = 0
        var end = clause.count
        while start < end, isPunctuation(clause[start]) { start += 1 }
        while end > start, isPunctuation(clause[end - 1]) { end -= 1 }
        if start == end { return clause.map { [$0] } }
        return clause[..<start].map { [$0] } + [Array(clause[start..<end])] + clause[end...].map { [$0] }
    }

    static func splitClauses(_ text: String) -> [String] {
        groupClauses(tokenize(text)).map { joinTokens($0) }
    }

    static func splitSentences(_ text: String) -> [String] {
        groupSentences(tokenize(text)).map { joinTokens($0) }
    }

    /* ---------------- bubbles ---------------- */

    static func words(_ texts: [String]) -> [BubbleWord] {
        texts.map { BubbleWord(id: newId(), text: $0) }
    }

    private static func tokens(of words: [BubbleWord]) -> [String] {
        words.flatMap { tokenize($0.text) }
    }

    /// The sentence a session writes back, capitalized where sentences now begin — if the
    /// sentence it began from began one.
    static func compose(_ words: [BubbleWord], original: String) -> String {
        joinTokens(tokens(of: words), startsSentence: startsCapitalized(original))
    }

    /// What each bubble of the sentence shows: its text, with a capital on the word that
    /// now begins a sentence. The bubbles store words without sentence-start capitals, so
    /// moving a word to the front capitalizes it and the word it displaced loses its capital.
    static func displayTexts(_ words: [BubbleWord], original: String) -> [String] {
        let perBubble = words.map { tokenize($0.text) }
        let tokens = perBubble.flatMap { $0 }
        let starts = sentenceStarts(tokens, roles(tokens), startsSentence: startsCapitalized(original))
        var offset = 0
        return words.enumerated().map { index, word in
            let own = perBubble[index]
            let first = offset
            offset += own.count
            guard own.indices.contains(where: { starts.contains(first + $0) }) else { return word.text }
            return joinTokens(own.enumerated().map { at, token in
                starts.contains(first + at) ? token.prefix(1).uppercased() + token.dropFirst() : token
            })
        }
    }

    /// Two bubbles' text as one, `first` before `second`.
    static func join(_ first: String, _ second: String) -> String {
        joinTokens(tokenize(first) + tokenize(second))
    }

    /// Every bubble split into one bubble per word and punctuation mark.
    static func regroupWords(_ words: [BubbleWord]) -> [BubbleWord] {
        words.flatMap { word in
            let parts = tokenize(word.text)
            return parts.count <= 1 ? [word] : Self.words(parts)
        }
    }

    /// The bubbles regrouped for a mode.
    ///
    /// A new bubble keeps the id of the old one that began at the same word, so its glass
    /// morphs from that bubble (a clause into its first word, a word into its clause)
    /// instead of one vanishing and another appearing.
    static func regroup(_ words: [BubbleWord], _ mode: BubbleMode) -> [BubbleWord] {
        let tokens = tokens(of: words)
        let groups: [[String]] = switch mode {
        case .words: tokens.map { [$0] }
        case .clauses: groupClauses(tokens)
        case .sentences: groupSentences(tokens)
        }
        var began: [Int: String] = [:]
        var offset = 0
        for word in words {
            began[offset] = word.id
            offset += tokenize(word.text).count
        }
        offset = 0
        return groups.map { group in
            defer { offset += group.count }
            return BubbleWord(id: began[offset] ?? newId(), text: joinTokens(group))
        }
    }

    /// Some text as bubbles, the first keeping `id` — a bubble split in place.
    static func words(_ texts: [String], keeping id: String) -> [BubbleWord] {
        texts.enumerated().map { BubbleWord(id: $0.offset == 0 ? id : newId(), text: $0.element) }
    }

    /// One level finer: a bubble of several sentences comes apart into sentences, a
    /// sentence into clauses, a clause into words. What spreading two fingers does.
    static func splitOnce(_ text: String) -> [String] {
        let sentences = splitSentences(text)
        if sentences.count > 1 { return sentences }
        let clauses = splitClauses(text)
        return clauses.count > 1 ? clauses : tokenize(text)
    }

    /// The bubbles at `index` and `index + 1` as one, keeping the first one's id.
    static func mergeAdjacent(_ words: [BubbleWord], at index: Int) -> [BubbleWord] {
        guard index >= 0, index + 1 < words.count else { return words }
        var next = words
        next[index] = BubbleWord(id: words[index].id, text: join(words[index].text, words[index + 1].text))
        next.remove(at: index + 1)
        return next
    }

    /// One bubble split into its words, in place.
    static func split(_ words: [BubbleWord], id: String) -> [BubbleWord] {
        words.flatMap { word in
            guard word.id == id else { return [word] }
            let parts = tokenize(word.text)
            return parts.count <= 1 ? [word] : Self.words(parts)
        }
    }
}
