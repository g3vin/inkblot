import SwiftUI

/// The hover cards over a note's marker, as Liquid Glass.
///
/// Drawn above the web view because that is the only place glass can be: it refracts
/// what is behind it, and what should be behind these is the document. The layout is
/// `NoteHoverPreview`'s, from `notePreviewGeometry.ts`: the root card beside its anchor
/// (right if there is room, else left), each reply below its parent, every card
/// draggable and resizable, and a string from the marker to the root and from each card
/// to its replies. Where a card was dragged to is stored on the note (`previewLayout`,
/// `previewSize`), so the page and this agree about where it goes.
///
/// Empty space in the overlay is not hit-testable, so everything that is not a card
/// still reaches the page underneath.
struct NotePreviewOverlay: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        GeometryReader { proxy in
            GlassMarkerDots(markers: model.notePreviews.markers, openNoteId: model.notePreviews.preview?.noteId)
                .allowsHitTesting(false)

            if let preview = model.notePreviews.preview, let root = rootNote(preview) {
                let layout = NotePreviewLayoutEngine(
                    root: root,
                    notes: notes(for: preview),
                    anchor: preview.anchor,
                    viewport: proxy.size,
                    panelInsets: model.notePreviews.panelInsets,
                    dragOffsets: model.notePreviews.dragOffsets,
                    sizeOverrides: model.notePreviews.sizeOverrides,
                    layoutOverrides: model.notePreviews.layoutOverrides,
                    renderedHeights: model.notePreviews.renderedHeights)

                let previews = model.notePreviews
                TimelineView(.animation(paused: previews.appearanceSettled)) { timeline in
                    let now = timeline.date
                    ZStack(alignment: .topLeading) {
                        Strings(layout: layout, anchorDot: dotCenter(of: preview.noteId) ?? layout.anchorCenter,
                                renderedHeights: previews.renderedHeights,
                                elasticOrigins: previews.elasticOrigins,
                                appearance: { previews.appearance(of: $0, at: now) })
                            .allowsHitTesting(false)

                        GlassEffectContainer(spacing: 24) {
                            ZStack(alignment: .topLeading) {
                                ForEach(layout.cards) { card in
                                    // A reply from a + button grows out of it (`GlassNoteCard`);
                                    // any other card slides in (`stageAppearance`).
                                    let spawn = previews.pendingSpawn
                                    let spawned = spawn != nil && spawn?.parentId == card.parentId
                                    let shown = previews.appearance(of: card.id, at: now)
                                    let origin = previews.elasticOrigins[card.id] ?? card.frame.origin
                                    GlassNoteCard(card: card, preview: preview,
                                                  spawnedFrom: spawned ? spawn?.origin : nil)
                                        .opacity(shown)
                                        .offset(x: origin.x + (1 - shown) * NotePreviewModel.appearSlide,
                                                y: origin.y)
                                        .transition(.asymmetric(insertion: .identity, removal: .opacity))
                                }
                            }
                        }
                    }
                }
                .animation(.spring(duration: 0.28), value: layout.cards.map(\.id))
                .onChange(of: layout.cards.map(\.id), initial: true) { previews.stageAppearance(of: layout.cards) }
                .onChange(of: layout.cards.map(\.frame), initial: true) { previews.cardsLaidOut(layout.cards) }
                .onExitCommand { model.notePreviews.close() }
                .onChange(of: layout.cards.first?.frame, initial: true) { _, frame in
                    model.notePreviews.rootCardFrame = frame
                }
            }
        }
        .onAppear { model.notePreviews.pointerSpace = model.web.webView }
    }

    /// The open note's glass dot, which its string starts from. The marker's own rect is
    /// a little wider than the dot it holds.
    private func dotCenter(of noteId: String) -> CGPoint? {
        model.notePreviews.markers.first { $0.noteId == noteId }.map(\.center)
    }

    private func notes(for preview: NotePreviewModel.Preview) -> [Note] {
        let sidebar = model.sidebar
        if sidebar.notesDocPath == preview.docPath, !sidebar.notes.isEmpty { return sidebar.notes }
        return preview.fallbackNote.map { [$0] } ?? []
    }

    private func rootNote(_ preview: NotePreviewModel.Preview) -> Note? {
        notes(for: preview).first { $0.id == preview.noteId } ?? preview.fallbackNote
    }
}

/* ---------------- layout ---------------- */

/// `notePreviewGeometry.ts`, in points.
struct NotePreviewLayoutEngine {
    struct Card: Identifiable {
        let note: Note
        let frame: CGRect
        let depth: Int
        let parentId: String?
        let childCount: Int
        /// Where a reply sits under its parent until it is dragged somewhere of its own.
        var defaultOffset: CGSize? = nil
        var id: String { note.id }
    }

    static let tileWidth: CGFloat = 260
    static let tileMinHeight: CGFloat = 88
    static let minResize = CGSize(width: 220, height: 64)
    /// The gap a card keeps from the edges of the page it can be seen on — the window's,
    /// or a sidebar's — all round.
    static let padding: CGFloat = 12
    /// The gap between a card's bottom edge and its replies.
    static let childGap: CGFloat = 48
    static let siblingGap: CGFloat = 16

    /// Replies hang below their parent, centred on it, side by side.
    static func defaultChildOffset(parent: CGSize, child: CGSize, index: Int, count: Int) -> CGSize {
        let pitch = child.width + siblingGap
        return CGSize(width: (parent.width - child.width) / 2 + (CGFloat(index) - CGFloat(count - 1) / 2) * pitch,
                      height: parent.height + childGap)
    }

    let anchor: CGRect
    private(set) var cards: [Card] = []

    init(root: Note, notes: [Note], anchor: CGRect, viewport: CGSize,
         panelInsets: EdgeInsets = EdgeInsets(),
         dragOffsets: [String: CGSize], sizeOverrides: [String: CGSize],
         layoutOverrides: [String: NotePreviewLayout] = [:],
         renderedHeights: [String: CGFloat] = [:]) {
        self.anchor = anchor
        let children = Dictionary(grouping: notes.filter { $0.parentNoteId != nil }) { $0.parentNoteId! }

        func size(_ note: Note) -> CGSize {
            sizeOverrides[note.id]
                ?? CGSize(width: max(Self.minResize.width, note.previewSize.width),
                          height: max(Self.minResize.height, note.previewSize.height))
        }
        func stored(_ note: Note) -> NotePreviewLayout {
            layoutOverrides[note.id] ?? note.previewLayout
        }
        // The page shows between the sidebars and below the toolbar — it runs on under
        // their glass — so that is where a card may go.
        let minX = panelInsets.leading + Self.padding
        let maxX = viewport.width - panelInsets.trailing - Self.padding
        let minY = panelInsets.top + Self.padding
        let maxY = viewport.height - Self.padding
        func clamp(_ origin: CGPoint, _ size: CGSize) -> CGPoint {
            CGPoint(
                x: min(max(origin.x, minX), max(minX, maxX - size.width)),
                y: min(max(origin.y, minY), max(minY, maxY - size.height)))
        }

        // getInitialTilePosition: right of the anchor if it fits, else left.
        let rootSize = size(root)
        let prefersRight = anchor.maxX + rootSize.width + 28 <= maxX
        let base = CGPoint(
            x: prefersRight ? anchor.maxX + 22 : anchor.minX - rootSize.width - 22,
            y: anchor.minY - rootSize.height * 0.3)
        let drag = dragOffsets[root.id] ?? .zero
        let rootOrigin = clamp(CGPoint(x: base.x + stored(root).offsetX + drag.width,
                                       y: base.y + stored(root).offsetY + drag.height), rootSize)

        var cards: [Card] = []
        func visit(_ note: Note, origin: CGPoint, depth: Int, parentId: String?, defaultOffset: CGSize?) {
            let kids = (children[note.id] ?? []).sorted(by: NoteTree.ordered)
            cards.append(Card(note: note, frame: CGRect(origin: origin, size: size(note)),
                              depth: depth, parentId: parentId, childCount: kids.count,
                              defaultOffset: defaultOffset))
            guard !note.collapsedChildren else { return }
            // Below the card as drawn, which its text may have made taller than its layout.
            let drawn = CGSize(width: size(note).width,
                               height: max(size(note).height, renderedHeights[note.id] ?? 0))
            for (index, child) in kids.enumerated() {
                // A reply that has never been dragged has a zero layout, which means "the
                // default".
                let layout = stored(child)
                let hasStored = layout.offsetX != 0 || layout.offsetY != 0
                let fallback = Self.defaultChildOffset(parent: drawn, child: size(child),
                                                       index: index, count: kids.count)
                let offset = hasStored ? CGSize(width: layout.offsetX, height: layout.offsetY) : fallback
                let drag = dragOffsets[child.id] ?? .zero
                let childOrigin = clamp(CGPoint(x: origin.x + offset.width + drag.width,
                                                y: origin.y + offset.height + drag.height), size(child))
                visit(child, origin: childOrigin, depth: depth + 1, parentId: note.id, defaultOffset: fallback)
            }
        }
        visit(root, origin: rootOrigin, depth: 0, parentId: nil, defaultOffset: nil)
        self.cards = cards
    }

    var anchorCenter: CGPoint { CGPoint(x: anchor.midX, y: anchor.midY) }

    /// The point on a card a string attaches to: its centre, as the page drew it.
    func center(of id: String) -> CGPoint? {
        cards.first { $0.id == id }.map { CGPoint(x: $0.frame.midX, y: $0.frame.midY) }
    }
}

/// A note's glass: its colour, washed out. The card and its marker's dot share it, so
/// the dot reads as a drop of the card.
enum NoteGlass {
    static func tint(_ hex: String) -> Color {
        (Color(hex: hex) ?? .accentColor).opacity(0.16)
    }
}

/// The note markers' dots, as Liquid Glass tinted with each note's colour, over the
/// page's own (which are invisible, and still take the hover and the click — so these
/// take none). The open note's dot swells, as the page's did under the pointer.
private struct GlassMarkerDots: View {
    let markers: [NoteMarkerRect]
    let openNoteId: String?

    static let diameter: CGFloat = 12
    static let openScale: CGFloat = 1.4

    var body: some View {
        ZStack(alignment: .topLeading) {
            // By position, not id: split panes can show one document twice.
            ForEach(Array(markers.enumerated()), id: \.offset) { _, marker in
                let open = marker.noteId == openNoteId
                Color.clear
                    .frame(width: Self.diameter, height: Self.diameter)
                    .glassEffect(.regular.tint(NoteGlass.tint(marker.color)), in: .circle)
                    .scaleEffect(open ? Self.openScale : 1)
                    .animation(.spring(duration: 0.25, bounce: 0.3), value: open)
                    .position(marker.center)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

extension NoteMarkerRect {
    var center: CGPoint { CGPoint(x: (left + right) / 2, y: (top + bottom) / 2) }
}

/// `getCurvePath`: a quadratic that bows upward with distance.
///
/// Not glass — a line of glass reads as a smear — but drawn to sit with it: a thin
/// tinted strand with a bright core, like the lit rim of the glass it joins, starting at
/// the edge of the marker's dot rather than under it.
private struct Strings: View {
    let layout: NotePreviewLayoutEngine
    let anchorDot: CGPoint
    /// How tall each card is drawn, which its text may have made taller than its layout.
    let renderedHeights: [String: CGFloat]
    /// Where trailing replies are drawn (`NotePreviewModel.elasticOrigins`).
    let elasticOrigins: [String: CGPoint]
    /// How far in each card is (`NotePreviewModel.appearance`): the string draws out to
    /// a card as it slides in, reaching its edge as it lands.
    let appearance: (String) -> CGFloat

    /// A card where it is drawn this frame: as tall as its text, and still sliding in.
    private func drawnFrame(_ card: NotePreviewLayoutEngine.Card) -> CGRect {
        var frame = card.frame
        if let origin = elasticOrigins[card.id] { frame.origin = origin }
        frame.size.height = max(frame.height, renderedHeights[card.id] ?? 0)
        return frame.offsetBy(dx: (1 - appearance(card.id)) * NotePreviewModel.appearSlide, dy: 0)
    }

    var body: some View {
        Canvas { context, _ in
            let frames = Dictionary(uniqueKeysWithValues: layout.cards.map { ($0.id, drawnFrame($0)) })
            for card in layout.cards {
                let shown = appearance(card.id)
                guard shown > 0, let frame = frames[card.id] else { continue }
                var from: CGPoint
                let parentFrame = card.parentId.flatMap { frames[$0] }
                if let parentFrame {
                    from = CGPoint(x: parentFrame.midX, y: parentFrame.midY)
                } else {
                    from = anchorDot
                }
                let to = CGPoint(x: frame.midX, y: frame.midY)
                let distance = hypot(to.x - from.x, to.y - from.y)
                let sway = min(max(distance * 0.12, 18), 70)
                let control = CGPoint(x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - sway)
                if card.parentId == nil {
                    // Out of the dot's rim, toward where the curve heads.
                    let radius = GlassMarkerDots.diameter * GlassMarkerDots.openScale / 2
                    let dx = control.x - from.x, dy = control.y - from.y
                    let length = max(hypot(dx, dy), 1)
                    from = CGPoint(x: from.x + dx / length * radius, y: from.y + dy / length * radius)
                }
                var path = Path()
                path.move(to: from)
                path.addQuadCurve(to: to, control: control)
                // Only the stretch between the two edges is ever seen, so that is what
                // draws out: its tip leaves the parent as the card sets off, and meets the
                // card's edge as it lands.
                let (leaves, enters) = Self.visibleSpan(from: from, control: control, to: to,
                                                        leaving: parentFrame, entering: frame)
                if shown < 1 {
                    path = path.trimmedPath(from: 0, to: leaves + (enters - leaves) * shown)
                }
                drawStrand(path, color: Color(hex: card.note.color) ?? .accentColor, in: context)
            }
            // The cards are glass, so a string running under one would show through it:
            // each string stops at the card's edge.
            context.blendMode = .clear
            for card in layout.cards {
                guard let drawn = frames[card.id] else { continue }
                context.fill(RoundedRectangle(cornerRadius: GlassNoteCard.cornerRadius).path(in: drawn),
                             with: .color(.black))
            }
        }
    }

    /// Where along a string, as fractions of its length, it comes out from under its
    /// parent's card and goes under its own.
    private static func visibleSpan(from: CGPoint, control: CGPoint, to: CGPoint,
                                    leaving parent: CGRect?, entering card: CGRect) -> (CGFloat, CGFloat) {
        let steps = 64
        var lengths: [CGFloat] = [0]
        var points = [from]
        for i in 1...steps {
            let t = CGFloat(i) / CGFloat(steps), u = 1 - t
            let point = CGPoint(x: u * u * from.x + 2 * u * t * control.x + t * t * to.x,
                                y: u * u * from.y + 2 * u * t * control.y + t * t * to.y)
            lengths.append(lengths[i - 1] + hypot(point.x - points[i - 1].x, point.y - points[i - 1].y))
            points.append(point)
        }
        guard let total = lengths.last, total > 0 else { return (0, 1) }
        let leaves = parent.flatMap { rect in points.lastIndex { rect.contains($0) } } ?? 0
        let enters = points.indices.first { $0 > leaves && card.contains(points[$0]) } ?? steps
        return (lengths[leaves] / total, lengths[enters] / total)
    }

    private func drawStrand(_ path: Path, color: Color, in context: GraphicsContext) {
        context.stroke(path, with: .color(color.opacity(0.4)),
                       style: StrokeStyle(lineWidth: 3, lineCap: .round))
        context.stroke(path, with: .color(.white.opacity(0.7)),
                       style: StrokeStyle(lineWidth: 0.75, lineCap: .round))
    }
}

/* ---------------- one card ---------------- */

/// At least `minHeight` tall, taller if the content needs it — and, unlike
/// `.frame(minHeight:)`, the content is given that height, so a spacer in it can push
/// the card's footer to the bottom edge instead of leaving it under the text.
private struct FillHeight: ViewModifier {
    let minHeight: CGFloat

    func body(content: Content) -> some View {
        FillHeightLayout(minHeight: minHeight) { content }
    }
}

private struct FillHeightLayout: Layout {
    let minHeight: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        guard let content = subviews.first else { return .zero }
        // The content's own width, not the proposal's: the overlay proposes the whole
        // window, and taking it would stretch the card's glass across the screen.
        let ideal = content.sizeThatFits(ProposedViewSize(width: proposal.width, height: nil))
        return CGSize(width: ideal.width, height: max(ideal.height, minHeight))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        subviews.first?.place(at: bounds.origin, proposal: ProposedViewSize(bounds.size))
    }
}

private struct GlassNoteCard: View {
    @Environment(AppModel.self) private var model
    let card: NotePreviewLayoutEngine.Card
    let preview: NotePreviewModel.Preview
    @State private var resizeStart: CGSize?
    @State private var drawnHeight: CGFloat = 0

    /// A reply made from its parent's + button is born there: the + itself, as a drop of
    /// glass (`bud`), slides out of the parent and down to where the card goes
    /// (`travelled`), and opens into it (`card`). Every other card is a card from the
    /// start.
    private enum Growth { case bud, travelled, card }
    @State private var growth: Growth
    private let spawnedFrom: CGPoint?

    static let budSize: CGFloat = 26
    static let cornerRadius: CGFloat = 18

    init(card: NotePreviewLayoutEngine.Card, preview: NotePreviewModel.Preview, spawnedFrom: CGPoint?) {
        self.card = card
        self.preview = preview
        self.spawnedFrom = spawnedFrom
        _growth = State(initialValue: spawnedFrom == nil ? .card : .bud)
    }

    var body: some View {
        let grown = growth == .card
        let shape = RoundedRectangle(cornerRadius: grown ? Self.cornerRadius : Self.budSize / 2)

        content
            .opacity(grown ? 1 : 0)
            // Centred, not leading: the card opens around its contents, which hold still.
            // Pinned to the bud's leading edge, they would ride in with it from the right.
            .frame(width: grown ? nil : Self.budSize, height: grown ? nil : Self.budSize, alignment: .center)
            .clipShape(shape)
            .glassEffect(.regular.tint(NoteGlass.tint(card.note.color)).interactive(), in: shape)
            // The bud carries the + it left with, until it opens.
            .overlay {
                if !grown { plusGlyph.transition(.opacity) }
            }
            .overlay(alignment: .bottom) {
                if grown {
                    spawnButton
                        .opacity(model.notePreviews.budding.contains(card.id) ? 0 : 1)
                        .animation(.easeInOut(duration: 0.2), value: model.notePreviews.budding.contains(card.id))
                }
            }
            .offset(budOffset)
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height in
                guard grown else { return }
                drawnHeight = height
                model.notePreviews.renderedHeights[card.id] = height
            }
            // Not `onAppear`: that runs before the bud is first drawn, so there is nothing
            // on screen to animate from — the state jumps to its end, the completion fires
            // at once, and the card just appears. A frame later, the bud is there to move.
            .task {
                guard growth == .bud else { return }
                try? await Task.sleep(for: .milliseconds(16))
                grow()
            }
    }

    /// Where the bud is, from where the card will be.
    private var budOffset: CGSize {
        let half = Self.budSize / 2
        switch growth {
        case .card:
            return .zero
        case .travelled:
            return CGSize(width: card.frame.width / 2 - half, height: card.frame.height / 2 - half)
        case .bud:
            let origin = spawnedFrom ?? CGPoint(x: card.frame.midX, y: card.frame.midY)
            return CGSize(width: origin.x - card.frame.minX - half, height: origin.y - card.frame.minY - half)
        }
    }

    private func grow() {
        guard growth == .bud else { return }
        let previews = model.notePreviews
        previews.pendingSpawn = nil
        // Slow enough to be seen leaving: the first stretch is inside the parent's glass,
        // which it pulls out of like a drop.
        withAnimation(.spring(duration: 0.55, bounce: 0.1)) {
            growth = .travelled
        } completion: {
            if let parentId = card.parentId { previews.budding.remove(parentId) }
            withAnimation(.spring(duration: 0.45, bounce: 0.2)) { growth = .card }
        }
    }

    private var plusGlyph: some View {
        Image(systemName: "plus")
            .font(.system(size: 11, weight: .semibold))
            .frame(width: Self.budSize, height: Self.budSize)
    }

    /// The + inside the card's bottom edge, centred: a reply, grown out of it.
    private var spawnButton: some View {
        Button { spawnReply() } label: {
            plusGlyph.contentShape(.circle)
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.tint(NoteGlass.tint(card.note.color)).interactive(), in: .circle)
        .padding(.bottom, 8)
        .help("Add a connected note")
    }

    private func spawnReply() {
        let previews = model.notePreviews
        previews.pin()
        let bottom = card.frame.minY + max(card.frame.height, drawnHeight) - 8 - Self.budSize / 2
        let spawn = NotePreviewModel.Spawn(parentId: card.id, origin: CGPoint(x: card.frame.midX, y: bottom))
        previews.pendingSpawn = spawn
        previews.budding.insert(card.id)
        model.sidebar.addReply(to: card.note, in: preview.docPath)
        // If the page never answers, the next card to appear should not grow out of here,
        // and this card's + comes back.
        let id = card.id
        Task {
            try? await Task.sleep(for: .seconds(3))
            if previews.pendingSpawn == spawn {
                previews.pendingSpawn = nil
                previews.budding.remove(id)
            }
        }
    }

    private var content: some View {
        let previews = model.notePreviews

        return VStack(spacing: 0) {
            // The grab strip — unmarked, as a window's titlebar is. Dragging from anywhere
            // would fight the text field.
            HStack(spacing: 8) {
                if card.childCount > 0 {
                    NoteCollapseButton(note: card.note, docPath: preview.docPath)
                }
                Spacer()
                NoteActions(note: card.note, hasChildren: card.childCount > 0, docPath: preview.docPath,
                            spacing: 8, showsCollapse: false)
            }
            .buttonStyle(.borderless)
            .font(.caption)
            .padding(.horizontal, 12)
            .padding(.top, 8)
            .contentShape(.rect)
            .gesture(moveGesture)

            NoteCardView(note: card.note, hasChildren: card.childCount > 0, glass: true)
                .simultaneousGesture(TapGesture().onEnded { previews.pin() })
        }
        .frame(width: card.frame.width, alignment: .topLeading)
        .modifier(FillHeight(minHeight: card.frame.height))
        // No visible handles: the edges and corners themselves resize, as a window's do,
        // and the pointer says which way.
        .overlay { resizeHandles }
        // The page's echo of a committed drag or resize: from here the note itself says
        // where the card is, and the stand-ins can go.
        .onChange(of: card.note.previewLayout) { previews.layoutOverrides[card.id] = nil }
        .onChange(of: card.note.previewSize) { previews.sizeOverrides[card.id] = nil }
        .onHover { previews.cardHovered(card.id, $0) }
    }

    private var moveGesture: some Gesture {
        DragGesture(minimumDistance: 3, coordinateSpace: .global)
            .onChanged { value in
                model.notePreviews.pin()
                if model.notePreviews.dragOffsets[card.id] == nil { model.notePreviews.beginDrag(of: card.id) }
                model.notePreviews.dragOffsets[card.id] = value.translation
            }
            .onEnded { value in
                // Committed before the offset goes, so the card never has neither.
                commitMove(by: value.translation)
                model.notePreviews.dragOffsets[card.id] = nil
                model.notePreviews.endDrag()
            }
    }

    /// Store the card's position moved by `translation`, relative to where it sits now.
    private func commitMove(by translation: CGSize) {
        let previews = model.notePreviews
        // A drop not yet echoed is where the card is now, not the note's older layout.
        let stored = previews.layoutOverrides[card.id] ?? card.note.previewLayout
        // A reply that was never moved sits at the default offset, not at zero.
        let base = stored.offsetX == 0 && stored.offsetY == 0
            ? card.defaultOffset ?? .zero
            : CGSize(width: stored.offsetX, height: stored.offsetY)
        let layout = NotePreviewLayout(offsetX: base.width + translation.width,
                                       offsetY: base.height + translation.height)
        previews.layoutOverrides[card.id] = layout
        model.sidebar.updateNote(card.note, in: preview.docPath, .with(previewLayout: layout))
        clearStandIns(after: .seconds(2))
    }

    /// In case the echo never comes — the note deleted, the page busy — or comes back
    /// equal to what was there, which `onChange` does not see.
    /// Only the stand-ins this gesture set: a later drop's are that drop's to clear.
    private func clearStandIns(after delay: Duration) {
        let previews = model.notePreviews
        let id = card.id
        let layout = previews.layoutOverrides[id]
        let size = previews.sizeOverrides[id]
        Task {
            try? await Task.sleep(for: delay)
            if let layout, previews.layoutOverrides[id] == layout { previews.layoutOverrides[id] = nil }
            if let size, previews.sizeOverrides[id] == size { previews.sizeOverrides[id] = nil }
        }
    }

    /// Which way each handle grows the card: -1 moves the leading or top edge, 1 the
    /// trailing or bottom one, 0 leaves that axis alone.
    private static let handles: [(position: FrameResizePosition, x: CGFloat, y: CGFloat)] = [
        (.top, 0, -1), (.bottom, 0, 1), (.leading, -1, 0), (.trailing, 1, 0),
        (.topLeading, -1, -1), (.topTrailing, 1, -1), (.bottomLeading, -1, 1), (.bottomTrailing, 1, 1),
    ]

    /// Thin strips along the edges and squares in the corners, over the card's rim.
    private var resizeHandles: some View {
        ZStack {
            ForEach(0..<Self.handles.count, id: \.self) { index in
                resizeHandle(Self.handles[index])
            }
        }
    }

    private func resizeHandle(_ handle: (position: FrameResizePosition, x: CGFloat, y: CGFloat)) -> some View {
        let edge: CGFloat = 6
        let corner: CGFloat = 16
        let isCorner = handle.x != 0 && handle.y != 0
        let thickness: CGFloat = isCorner ? corner : edge
        let alignment = SwiftUI.Alignment(
            horizontal: handle.x < 0 ? .leading : handle.x > 0 ? .trailing : .center,
            vertical: handle.y < 0 ? .top : handle.y > 0 ? .bottom : .center)
        return Color.clear
            .frame(width: handle.x == 0 ? nil : thickness, height: handle.y == 0 ? nil : thickness)
            // An edge stops short of the corners, which are the corners' own.
            .padding(.horizontal, handle.x == 0 ? corner : 0)
            .padding(.vertical, handle.y == 0 ? corner : 0)
            .contentShape(.rect)
            .pointerStyle(.frameResize(position: handle.position,
                                       directions: resizeDirections(x: handle.x, y: handle.y)))
            .gesture(resizeGesture(x: handle.x, y: handle.y))
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: alignment)
    }

    /// At its minimum size a card can only grow, and the pointer shows only the way out —
    /// as a window's edge does.
    private func resizeDirections(x: CGFloat, y: CGFloat) -> FrameResizeDirection.Set {
        let min = NotePreviewLayoutEngine.minResize
        let atMinWidth = x == 0 || card.frame.width <= min.width
        let atMinHeight = y == 0 || card.frame.height <= min.height
        return atMinWidth && atMinHeight ? .outward : .all
    }

    /// Resize from one handle. Moving a leading or top edge also moves the card by as much,
    /// so the opposite edge stays where it is.
    private func resizeGesture(x: CGFloat, y: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 1, coordinateSpace: .global)
            .onChanged { value in
                let start = resizeStart ?? card.frame.size
                resizeStart = start
                let min = NotePreviewLayoutEngine.minResize
                let size = CGSize(
                    width: x == 0 ? start.width : max(min.width, start.width + x * value.translation.width),
                    height: y == 0 ? start.height : max(min.height, start.height + y * value.translation.height))
                let previews = model.notePreviews
                previews.pin()
                previews.sizeOverrides[card.id] = size
                previews.dragOffsets[card.id] = CGSize(width: x < 0 ? start.width - size.width : 0,
                                                       height: y < 0 ? start.height - size.height : 0)
            }
            .onEnded { _ in
                let previews = model.notePreviews
                if let size = previews.sizeOverrides[card.id] {
                    model.sidebar.updateNote(card.note, in: preview.docPath, .with(previewSize: NotePreviewSize(
                        width: size.width, height: size.height)))
                }
                if let shift = previews.dragOffsets[card.id], shift != .zero {
                    commitMove(by: shift)
                }
                previews.dragOffsets[card.id] = nil
                resizeStart = nil
                // The size override stays until the page's echo arrives (`onChange` above),
                // so the card does not snap back for a frame.
                clearStandIns(after: .seconds(2))
            }
    }
}
