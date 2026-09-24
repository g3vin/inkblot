import AppKit
import SwiftUI

/// The bubble editor, over the whole window: a sentence as a row of Liquid Glass bubbles.
///
/// Every bubble is glass in one `GlassEffectContainer`, each with its own
/// `glassEffectID`, so the glass behaves like the thing it is named after: a bubble
/// dragged close to another begins to flow into it, a join melts two into one, a split
/// pulls one apart, and a bubble thrown to an edge travels there as a drop. The rest is
/// the page's `BubbleEditor.jsx`, which the Tauri app uses:
///
///   - drag between two bubbles to move one there; touch it against one to join them, on
///     the side it touched
///   - drop at, or throw toward, any edge to set it aside; drop on the bin to delete it
///   - pinch in over a gap to merge the bubbles either side; spread over a bubble to
///     split it one level finer (sentences, then clauses, then words)
///   - type to make a new word (Space starts the next), double-click to edit one
///   - Sentences / Clauses / Words (`BubbleTopControls`) regroup the whole text — Sentences to reorder a
///     paragraph; a selected bubble can be split alone
///   - Save as Form (⌘S) keeps the arrangement to come back to, as many as wanted; the
///     bar at the bottom moves between them (`BubbleFormsBar`) — its dots, ⌘[ and ⌘], or
///     a deliberate two-finger swipe sideways (`BubbleSwipeCatcher`) — and deletes the
///     one showing (⌘⌫)
///   - Done (the green ✓, ⌘↩, or Escape) writes the sentence and keeps the session; Archive writes it
///     and puts the session away in the document's archive (History ▸ Archive)
struct BubbleOverlay: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ZStack {
            if model.bubble.open != nil {
                BubbleEditorView(bubble: model.bubble)
                    .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.2), value: model.bubble.open?.id)
    }
}

private struct BubbleEditorView: View {
    @Bindable var bubble: BubbleModel
    @Environment(\.undoManager) private var undoManager
    @Namespace private var glass
    @FocusState private var focus: Focus?
    /// Whether the pinch under way has already merged or split something.
    @State private var pinchSpent = false

    private enum Focus: Hashable { case stage, field }
    static let space = "bubble-editor"
    private static let motion = Animation.spring(duration: 0.34, bounce: 0.22)
    private static let regrouping = Animation.bubbleRegrouping

    var body: some View {
        GeometryReader { proxy in
            let size = proxy.size
            let rowWidth = min(880, max(240, size.width - 240))
            ZStack(alignment: .topLeading) {
                scrim
                edgeGlow
                // Outside the bubbles' glass container, so a bubble dragged over it does not
                // flow into it, and under them, so the bubble stays in front.
                trash.position(x: size.width / 2, y: size.height - 56)

                GlassEffectContainer(spacing: 6) {
                    ZStack {
                        sentenceRow
                            .frame(maxWidth: rowWidth)
                            // Read when a drag starts; the model does not redraw on it.
                            .onGeometryChange(for: CGRect.self) { $0.frame(in: .named(Self.space)) } action: {
                                bubble.rowFrame = $0
                            }
                            // Where the preview goes. A preference rather than state: a
                            // measurement written back into state lays the view out again in
                            // the same frame, and glass may only be updated once a frame.
                            .anchorPreference(key: RowBounds.self, value: .bounds) { $0 }
                            .frame(width: size.width, height: size.height)

                        ForEach(bubble.arrangement.aside, id: \.id) { word in
                            glassBubble(id: word.id, text: word.text, aside: true)
                                .position(x: word.x * size.width, y: word.y * size.height)
                        }

                    }
                    .frame(width: size.width, height: size.height)
                }
                // Following the fingers while a swipe toward another form is under way.
                .offset(x: bubble.swipeOffset)
                .opacity(1 - min(0.35, abs(bubble.swipeOffset) / 600))

                // Where the bin is while a bubble is dragged, and gone meanwhile for it.
                if bubble.drag == nil {
                    BubbleFormsBar(bubble: bubble)
                        .position(x: size.width / 2, y: size.height - 56)
                        .transition(.opacity.combined(with: .scale(scale: 0.9)))
                }

                caret
                BubbleTopControls(bubble: bubble).frame(width: size.width).padding(.top, 14)
                // The window toolbar is hidden while the editor is up, and took the traffic
                // lights with it.
                BubbleWindowButtons().frame(width: size.width, height: size.height)
                BubbleSwipeCatcher(bubble: bubble).frame(width: 0, height: 0)
            }
            .animation(.easeOut(duration: 0.16), value: bubble.drag == nil)
            .overlayPreferenceValue(RowBounds.self) { anchor in
                GeometryReader { geometry in
                    if let anchor {
                        preview
                            .frame(width: rowWidth)
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                            .offset(y: geometry[anchor].maxY + 22)
                    }
                }
            }
            .coordinateSpace(.named(Self.space))
            .simultaneousGesture(pinch)
            .onAppear { bubble.stage = size }
            .onChange(of: size) { _, next in bubble.stage = next }
        }
        .ignoresSafeArea()
        .focusable()
        .focused($focus, equals: .stage)
        .focusEffectDisabled()
        .onKeyPress(phases: .down, action: key)
        .onExitCommand(perform: escape)
        .onAppear {
            bubble.undoManager = undoManager
            focus = .stage
        }
        .onChange(of: focus) { old, new in
            // A click away from a bubble being typed in finishes it.
            if old == .field, new != .field { withAnimation(Self.motion) { _ = bubble.commitEditing() } }
        }
    }

    /* ---------------- the sentence ---------------- */

    private enum RowItem: Identifiable {
        case word(BubbleWord)
        case draft(BubbleModel.Editing)
        var id: String {
            switch self {
            case .word(let word): word.id
            // One id for every draft: typing Space starts the next word in the same field,
            // so it keeps the keyboard. A new field would lose it, and losing it commits.
            case .draft: "draft"
            }
        }
    }

    private var rowItems: [RowItem] {
        var items = bubble.arrangement.words.map(RowItem.word)
        if let editing = bubble.editing, editing.draft {
            items.insert(.draft(editing), at: min(editing.index, items.count))
        }
        return items
    }

    @ViewBuilder private var sentenceRow: some View {
        let items = rowItems
        // What each bubble shows: capitalized where it now begins a sentence.
        let words = bubble.arrangement.words
        let shown = Dictionary(uniqueKeysWithValues: zip(
            words.map(\.id), BubbleText.displayTexts(words, original: bubble.open?.original ?? "")))
        if items.isEmpty {
            Text("Type, or drag a bubble back here")
                .foregroundStyle(.secondary)
                .frame(minHeight: 44)
        } else {
            BubbleFlow(spacing: BubbleDrop.rowGap) {
                ForEach(items) { item in
                    switch item {
                    case .word(let word): glassBubble(id: word.id, text: shown[word.id] ?? word.text, aside: false)
                    case .draft: field(draft: true)
                            .padding(.horizontal, 12)
                            .frame(minHeight: 42)
                            .glassEffect(.regular.tint(.accentColor.opacity(0.18)), in: .capsule)
                            .glassEffectID(item.id, in: glass)
                    }
                }
            }
        }
    }

    private func glassBubble(id: String, text: String, aside: Bool) -> some View {
        let selected = bubble.selectedId == id
        let dragging = bubble.drag?.id == id
        let editing = bubble.editing.map { !$0.draft && $0.id == id } ?? false
        // Both change with a spring (`BubbleModel.setDrag`): the target grows to meet the
        // dragged bubble rather than jumping.
        let joinTarget = bubble.joinTargetId == id
        let trashing = dragging && bubble.trashArmed
        // A join tints both halves of it: the bubble being dragged and the one it touches.
        let joining = dragging && bubble.joinTargetId != nil
        let tint: Color? = trashing ? .red.opacity(0.4)
            : joinTarget || joining ? .accentColor.opacity(0.32)
            : selected ? .accentColor.opacity(0.22) : nil

        // Punctuation is a round bubble, as tall as the word bubbles beside it.
        let round = !editing && BubbleText.isPunctuation(text)
        let height: CGFloat = aside ? 36 : 42
        let shape = round ? AnyShape(.circle) : AnyShape(.capsule)

        return Group {
            if editing {
                field(draft: false)
            } else {
                Text(text)
                    .fontWeight(round ? .semibold : nil)
                    .lineLimit(1)
                    .fixedSize()
            }
        }
        .font(.system(size: aside ? 16 : 19, design: .serif))
        .padding(.horizontal, round ? 0 : aside ? 14 : 18)
        .frame(minWidth: round ? height : nil, minHeight: height)
        .contentShape(shape)
        .glassEffect(.regular.tint(tint).interactive(), in: shape)
        .glassEffectID(id, in: glass)
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .named(Self.space)) } action: { bubble.frames[id] = $0 }
        .overlay(alignment: .top) {
            if selected && !editing { actions(for: id, aside: aside).offset(y: -52).fixedSize() }
        }
        .scaleEffect(joinTarget ? 1.08 : dragging ? (trashing ? 0.8 : 1.05) : 1)
        .offset(dragging ? bubble.drag?.translation ?? .zero : .zero)
        .zIndex(dragging ? 10 : selected ? 5 : 0)
        .gesture(dragGesture(id))
        .onTapGesture(count: 2) { withAnimation(Self.motion) { bubble.edit(id) } }
        // Simultaneous, so a click selects at once rather than after the double-click
        // interval has run out.
        .simultaneousGesture(TapGesture().onEnded {
            _ = bubble.commitEditing()
            bubble.selectedId = id
            focus = .stage
        })
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(text)
        .accessibilityAddTraits(.isButton)
        .accessibilityAction(named: "Edit") { bubble.edit(id) }
        .accessibilityAction(named: aside ? "Return to sentence" : "Set aside") {
            withAnimation(Self.motion) { aside ? bubble.returnToSentence(id) : bubble.setAside(id) }
        }
        .accessibilityAction(named: "Delete") { withAnimation(Self.motion) { bubble.remove(id) } }
    }

    /// Pinching on the trackpad: in over a gap merges the bubbles either side, out over a
    /// bubble splits it one level finer. One pinch, one change — the first time the
    /// fingers have moved far enough either way.
    private var pinch: some Gesture {
        MagnifyGesture(minimumScaleDelta: 0.02)
            .onChanged { value in
                guard !pinchSpent, bubble.drag == nil, bubble.editing == nil,
                      value.magnification > 1.2 || value.magnification < 0.83 else { return }
                withAnimation(Self.regrouping) {
                    // The gesture's own coordinates are this view's, which are the stage's.
                    pinchSpent = bubble.pinch(spreading: value.magnification > 1, at: value.startLocation)
                }
            }
            .onEnded { _ in pinchSpent = false }
    }

    private func dragGesture(_ id: String) -> some Gesture {
        DragGesture(minimumDistance: 3, coordinateSpace: .named(Self.space))
            .onChanged { value in
                bubble.dragChanged(id, location: value.location, translation: value.translation)
            }
            .onEnded { value in
                withAnimation(Self.motion) {
                    bubble.dragEnded(id, location: value.location, predicted: value.predictedEndLocation,
                                     translation: value.translation)
                }
            }
    }

    private func field(draft: Bool) -> some View {
        // Sized by an invisible copy of its text rather than `fixedSize()`: a text field
        // asked for its ideal size while the bubble around it animates gets proposals it
        // cannot satisfy, and says so every frame.
        let text = bubble.editing?.text ?? ""
        return Text(text.isEmpty ? (draft ? "word" : " ") : text)
            .font(.system(size: 19, design: .serif))
            .lineLimit(1)
            .padding(.horizontal, 4)
            .frame(minWidth: 28)
            .hidden()
            .overlay {
                TextField(draft ? "word" : "", text: Binding(
                    get: { bubble.editing?.text ?? "" },
                    set: { bubble.editing?.text = $0 }))
                    .textFieldStyle(.plain)
                    .font(.system(size: 19, design: .serif))
                    .multilineTextAlignment(.center)
                    .focused($focus, equals: .field)
                    .onSubmit {
                        withAnimation(Self.motion) { _ = bubble.commitEditing() }
                        focus = .stage
                    }
                    .onKeyPress(.space) {
                        // A space ends a new word and starts the next; in an existing
                        // bubble it is a space, because a bubble may hold several words.
                        guard draft else { return .ignored }
                        withAnimation(Self.motion) { bubble.nextDraft() }
                        return .handled
                    }
                    .onKeyPress(.escape) {
                        bubble.editing = nil
                        focus = .stage
                        return .handled
                    }
            }
            // The field takes the keyboard once it is on screen. Asked for any sooner — in
            // the same update that creates it — there is no field to focus, focus falls to
            // nothing, and falling away from the field is what commits it: one letter typed.
            .task {
                focus = .field
                // Focusing a field selects what is in it, and a new word already holds the
                // letter that started it: the next keystroke would replace it. The caret
                // goes after it instead. (Editing a bubble keeps the selection, as a rename.)
                guard draft else { return }
                await Task.yield()
                if let editor = NSApp.keyWindow?.firstResponder as? NSTextView {
                    editor.setSelectedRange(NSRange(location: (editor.string as NSString).length, length: 0))
                }
            }
    }

    private func actions(for id: String, aside: Bool) -> some View {
        let multiword = BubbleText.tokenize(bubble.arrangement.text(of: id) ?? "").count > 1
        return HStack(spacing: 4) {
            if multiword {
                Button("Split") { withAnimation(Self.regrouping) { bubble.split(id) } }
            }
            if aside {
                Button("Return") { withAnimation(Self.motion) { bubble.returnToSentence(id) } }
            } else {
                Button("Set Aside") { withAnimation(Self.motion) { bubble.setAside(id) } }
            }
            Button("Edit") { withAnimation(Self.motion) { bubble.edit(id) } }
            Button("Delete", role: .destructive) { withAnimation(Self.motion) { bubble.remove(id) } }
        }
        .buttonStyle(.glass)
        .buttonBorderShape(.capsule)
        .controlSize(.small)
        .font(.system(size: 12))
    }

    /* ---------------- around it ---------------- */

    private var scrim: some View {
        Rectangle()
            .fill(.ultraThinMaterial)
            .overlay(Color.black.opacity(0.08))
            .contentShape(Rectangle())
            .onTapGesture {
                withAnimation(Self.motion) { _ = bubble.commitEditing() }
                bubble.selectedId = nil
                focus = .stage
            }
    }

    /// The edges light up while a drop there would set the bubble aside.
    private var edgeGlow: some View {
        let armed: Bool = { if case .aside = bubble.drag?.target { return true }; return false }()
        return Rectangle()
            .strokeBorder(Color.accentColor.opacity(0.55), lineWidth: 2)
            .shadow(color: .accentColor.opacity(0.5), radius: 24)
            .opacity(armed ? 1 : bubble.drag != nil ? 0.3 : 0)
            .animation(.easeOut(duration: 0.16), value: armed)
            .animation(.easeOut(duration: 0.16), value: bubble.drag != nil)
            .allowsHitTesting(false)
    }

    @ViewBuilder private var caret: some View {
        if case .insert(_, let caret) = bubble.drag?.target {
            Capsule()
                .fill(Color.accentColor)
                .frame(width: 3, height: caret.height)
                .shadow(color: .accentColor.opacity(0.6), radius: 6)
                .position(x: caret.midX, y: caret.midY)
                .allowsHitTesting(false)
        }
    }

    private var trash: some View {
        let armed = bubble.trashArmed
        // The glyph is sized as an image, not a font: a symbol set in a font sits on the
        // font's line metrics and comes out off-centre in its circle.
        return Color.clear
            .frame(width: 56, height: 56)
            .glassEffect(.regular.tint(armed ? .red.opacity(0.75) : nil), in: .circle)
            .overlay {
                Image(systemName: armed ? "trash.fill" : "trash")
                    .resizable()
                    .scaledToFit()
                    .fontWeight(.medium)
                    .frame(width: 20, height: 22)
                    .foregroundStyle(armed ? Color.white : Color.secondary)
            }
            .scaleEffect(armed ? 1.14 : bubble.drag != nil ? 1 : 0.8)
            .opacity(bubble.drag != nil ? 1 : 0)
            .animation(.spring(duration: 0.24), value: armed)
            .animation(.spring(duration: 0.24), value: bubble.drag != nil)
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .named(Self.space)) } action: { bubble.trashFrame = $0 }
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }

    private var preview: some View {
        VStack(spacing: 8) {
            let sentence = bubble.sentence
            Text(sentence.isEmpty ? "Leaving with no words removes the sentence." : sentence)
                .font(sentence.isEmpty ? .callout : .system(size: 19, design: .serif))
                .foregroundStyle(sentence.isEmpty ? .tertiary : .secondary)
                .multilineTextAlignment(.center)
                .textSelection(.enabled)
            if let original = bubble.open?.original, !original.isEmpty, original != sentence {
                Text("Was: \(original)")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .multilineTextAlignment(.center)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .animation(nil, value: bubble.sentence)
    }

    /* ---------------- keys ---------------- */

    private func key(_ press: KeyPress) -> KeyPress.Result {
        guard bubble.editing == nil else { return .ignored }
        if press.modifiers.contains(.command) { return formKey(press) }
        let selected = bubble.selectedId
        switch press.key {
        case .delete, .deleteForward:
            guard let selected else { return .ignored }
            withAnimation(Self.motion) { bubble.remove(selected) }
            return .handled
        case .return:
            guard let selected else { return .ignored }
            bubble.edit(selected)
            return .handled
        case .leftArrow, .rightArrow:
            guard selected != nil, press.modifiers.contains(.option) else { return .ignored }
            withAnimation(Self.motion) { bubble.moveSelected(by: press.key == .leftArrow ? -1 : 1) }
            return .handled
        default:
            break
        }
        let typed = press.characters
        guard typed.count == 1, let character = typed.first, !character.isWhitespace,
              character.isLetter || character.isNumber || character.isPunctuation || character.isSymbol
        else { return .ignored }
        withAnimation(Self.motion) { bubble.startDraft(typed) }
        return .handled
    }

    /// ⌘[ and ⌘] move between forms; ⌘⌫ deletes the one showing.
    private func formKey(_ press: KeyPress) -> KeyPress.Result {
        switch press.characters {
        case "[", "]":
            guard !bubble.forms.isEmpty else { return .ignored }
            withAnimation(Self.regrouping) { bubble.showForm(page: bubble.formPage + (press.characters == "[" ? -1 : 1)) }
            return .handled
        default:
            guard press.key == .delete, let current = bubble.currentForm else { return .ignored }
            withAnimation(Self.regrouping) { bubble.deleteForm(at: current) }
            return .handled
        }
    }

    private func escape() {
        if bubble.editing != nil {
            bubble.editing = nil
            focus = .stage
        } else if bubble.selectedId != nil {
            bubble.selectedId = nil
        } else {
            bubble.close(archive: false)
        }
    }
}

/// The sentence: bubbles in lines, each line centred, wrapping at the width offered.
struct BubbleFlow: Layout {
    var spacing: CGFloat

    private struct Line {
        var indices: [Int] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func lines(_ maxWidth: CGFloat, _ sizes: [CGSize]) -> [Line] {
        var lines: [Line] = []
        var current = Line()
        for (index, size) in sizes.enumerated() {
            let width = current.indices.isEmpty ? size.width : current.width + spacing + size.width
            if !current.indices.isEmpty, width > maxWidth {
                lines.append(current)
                current = Line(indices: [index], width: size.width, height: size.height)
            } else {
                current.indices.append(index)
                current.width = width
                current.height = max(current.height, size.height)
            }
        }
        if !current.indices.isEmpty { lines.append(current) }
        return lines
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let sizes = subviews.map { $0.sizeThatFits(.unspecified) }
        let arranged = lines(proposal.width ?? .infinity, sizes)
        let widest = arranged.map(\.width).max() ?? 0
        let height = arranged.map(\.height).reduce(0, +) + spacing * CGFloat(max(0, arranged.count - 1))
        return CGSize(width: proposal.width ?? widest, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let sizes = subviews.map { $0.sizeThatFits(.unspecified) }
        var y = bounds.minY
        for line in lines(bounds.width, sizes) {
            var x = bounds.minX + (bounds.width - line.width) / 2
            for index in line.indices {
                let size = sizes[index]
                subviews[index].place(at: CGPoint(x: x, y: y + (line.height - size.height) / 2),
                                      proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += line.height + spacing
        }
    }
}

/// The sentence row's bounds, for placing the preview under it.
private struct RowBounds: PreferenceKey {
    static let defaultValue: Anchor<CGRect>? = nil
    static func reduce(value: inout Anchor<CGRect>?, nextValue: () -> Anchor<CGRect>?) {
        value = value ?? nextValue()
    }
}
