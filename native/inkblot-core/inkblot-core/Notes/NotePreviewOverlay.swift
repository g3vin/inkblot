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
            if let preview = model.notePreviews.preview, let root = rootNote(preview) {
                let layout = NotePreviewLayoutEngine(
                    root: root,
                    notes: notes(for: preview),
                    anchor: preview.anchor,
                    viewport: proxy.size,
                    dragOffsets: model.notePreviews.dragOffsets,
                    sizeOverrides: model.notePreviews.sizeOverrides)

                ZStack(alignment: .topLeading) {
                    Strings(layout: layout)
                        .allowsHitTesting(false)

                    GlassEffectContainer(spacing: 24) {
                        ZStack(alignment: .topLeading) {
                            ForEach(layout.cards) { card in
                                GlassNoteCard(card: card, preview: preview)
                                    .offset(x: card.frame.minX, y: card.frame.minY)
                                    .transition(.scale(scale: 0.92, anchor: .topLeading).combined(with: .opacity))
                            }
                        }
                    }
                }
                .animation(.spring(duration: 0.28), value: layout.cards.map(\.id))
                .onEscape { model.notePreviews.close() }
            }
        }
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
        var id: String { note.id }
    }

    static let tileWidth: CGFloat = 260
    static let tileMinHeight: CGFloat = 88
    static let minResize = CGSize(width: 220, height: 64)
    static let padding: CGFloat = 20
    static let childOffsetY: CGFloat = 184

    let anchor: CGRect
    private(set) var cards: [Card] = []

    init(root: Note, notes: [Note], anchor: CGRect, viewport: CGSize,
         dragOffsets: [String: CGSize], sizeOverrides: [String: CGSize]) {
        self.anchor = anchor
        let children = Dictionary(grouping: notes.filter { $0.parentNoteId != nil }) { $0.parentNoteId! }

        func size(_ note: Note) -> CGSize {
            sizeOverrides[note.id]
                ?? CGSize(width: max(Self.minResize.width, note.previewSize.width),
                          height: max(Self.minResize.height, note.previewSize.height))
        }
        func clamp(_ origin: CGPoint, _ size: CGSize) -> CGPoint {
            CGPoint(
                x: min(max(origin.x, Self.padding), max(Self.padding, viewport.width - size.width - Self.padding)),
                y: min(max(origin.y, Self.padding), max(Self.padding, viewport.height - size.height - Self.padding)))
        }

        // getInitialTilePosition: right of the anchor if it fits, else left.
        let rootSize = size(root)
        let prefersRight = anchor.maxX + rootSize.width + 28 <= viewport.width - Self.padding
        let base = CGPoint(
            x: prefersRight ? anchor.maxX + 22 : anchor.minX - rootSize.width - 22,
            y: anchor.minY - rootSize.height * 0.3)
        let drag = dragOffsets[root.id] ?? .zero
        let rootOrigin = clamp(CGPoint(x: base.x + root.previewLayout.offsetX + drag.width,
                                       y: base.y + root.previewLayout.offsetY + drag.height), rootSize)

        var cards: [Card] = []
        func visit(_ note: Note, origin: CGPoint, depth: Int, parentId: String?) {
            let kids = (children[note.id] ?? []).sorted(by: NoteTree.ordered)
            cards.append(Card(note: note, frame: CGRect(origin: origin, size: size(note)),
                              depth: depth, parentId: parentId, childCount: kids.count))
            guard !note.collapsedChildren else { return }
            for (index, child) in kids.enumerated() {
                // getDefaultChildOffset: fanned out beneath the parent. A reply that has
                // never been dragged has a zero layout, which means "the default".
                let stored = child.previewLayout
                let hasStored = stored.offsetX != 0 || stored.offsetY != 0
                let offset = hasStored
                    ? CGSize(width: stored.offsetX, height: stored.offsetY)
                    : CGSize(width: (CGFloat(index) - CGFloat(kids.count - 1) / 2) * 48, height: Self.childOffsetY)
                let drag = dragOffsets[child.id] ?? .zero
                let childOrigin = clamp(CGPoint(x: origin.x + offset.width + drag.width,
                                                y: origin.y + offset.height + drag.height), size(child))
                visit(child, origin: childOrigin, depth: depth + 1, parentId: note.id)
            }
        }
        visit(root, origin: rootOrigin, depth: 0, parentId: nil)
        self.cards = cards
    }

    /// The point on a card a string attaches to: its centre, as the page drew it.
    func center(of id: String) -> CGPoint? {
        cards.first { $0.id == id }.map { CGPoint(x: $0.frame.midX, y: $0.frame.midY) }
    }
}

/// `getCurvePath`: a quadratic that bows upward with distance.
private struct Strings: View {
    let layout: NotePreviewLayoutEngine

    var body: some View {
        Canvas { context, _ in
            for card in layout.cards {
                let from: CGPoint
                if let parentId = card.parentId, let parent = layout.center(of: parentId) {
                    from = parent
                } else {
                    from = CGPoint(x: layout.anchor.midX, y: layout.anchor.midY)
                }
                let to = CGPoint(x: card.frame.midX, y: card.frame.midY)
                let distance = hypot(to.x - from.x, to.y - from.y)
                let sway = min(max(distance * 0.12, 18), 70)
                var path = Path()
                path.move(to: from)
                path.addQuadCurve(to: to, control: CGPoint(x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - sway))
                let color = Color(hex: card.note.color) ?? .accentColor
                context.stroke(path, with: .color(color.opacity(0.55)), style: StrokeStyle(lineWidth: 1.5, lineCap: .round))
                if card.parentId == nil {
                    context.fill(Path(ellipseIn: CGRect(x: from.x - 3, y: from.y - 3, width: 6, height: 6)),
                                 with: .color(color))
                }
            }
        }
    }
}

/* ---------------- one card ---------------- */

private struct GlassNoteCard: View {
    @Environment(AppModel.self) private var model
    let card: NotePreviewLayoutEngine.Card
    let preview: NotePreviewModel.Preview
    @State private var resizeStart: CGSize?

    var body: some View {
        let previews = model.notePreviews
        let tint = Color(hex: card.note.color) ?? .accentColor

        VStack(spacing: 0) {
            // The grab strip. Dragging from anywhere would fight the text field.
            HStack(spacing: 8) {
                Capsule().fill(.secondary.opacity(0.5)).frame(width: 28, height: 4)
                Spacer()
                Button {
                    previews.pin()
                    model.sidebar.addReply(to: card.note, in: preview.docPath)
                } label: { Image(systemName: "arrowshape.turn.up.left") }
                    .help("Reply")
                if card.depth == 0 {
                    Button { previews.close() } label: { Image(systemName: "xmark") }
                        .help("Close")
                }
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
        .frame(minHeight: card.frame.height, alignment: .top)
        .overlay(alignment: .bottomTrailing) {
            Image(systemName: "arrow.down.right")
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(.secondary)
                .padding(6)
                .contentShape(.rect)
                .gesture(resizeGesture)
                .help("Resize")
        }
        .glassEffect(.regular.tint(tint.opacity(0.16)).interactive(), in: .rect(cornerRadius: 18))
        .onHover { previews.cardHovered(card.id, $0) }
    }

    private var moveGesture: some Gesture {
        DragGesture(minimumDistance: 3, coordinateSpace: .global)
            .onChanged { value in
                model.notePreviews.pin()
                model.notePreviews.dragOffsets[card.id] = value.translation
            }
            .onEnded { value in
                let previews = model.notePreviews
                previews.dragOffsets[card.id] = nil
                let stored = card.note.previewLayout
                // A reply that was never moved sits at the default offset, not at zero.
                let base = card.parentId != nil && stored.offsetX == 0 && stored.offsetY == 0
                    ? CGSize(width: 0, height: NotePreviewLayoutEngine.childOffsetY)
                    : CGSize(width: stored.offsetX, height: stored.offsetY)
                model.sidebar.updateNote(card.note, in: preview.docPath, .with(previewLayout: NotePreviewLayout(
                    offsetX: base.width + value.translation.width,
                    offsetY: base.height + value.translation.height)))
            }
    }

    private var resizeGesture: some Gesture {
        DragGesture(minimumDistance: 1, coordinateSpace: .global)
            .onChanged { value in
                let start = resizeStart ?? card.frame.size
                resizeStart = start
                model.notePreviews.pin()
                model.notePreviews.sizeOverrides[card.id] = CGSize(
                    width: max(NotePreviewLayoutEngine.minResize.width, start.width + value.translation.width),
                    height: max(NotePreviewLayoutEngine.minResize.height, start.height + value.translation.height))
            }
            .onEnded { _ in
                let previews = model.notePreviews
                if let size = previews.sizeOverrides[card.id] {
                    model.sidebar.updateNote(card.note, in: preview.docPath, .with(previewSize: NotePreviewSize(
                        width: size.width, height: size.height)))
                }
                resizeStart = nil
                // Keep the override until the page's echo arrives, so the card does not
                // snap back for a frame.
                Task {
                    try? await Task.sleep(for: .milliseconds(400))
                    previews.sizeOverrides[card.id] = nil
                }
            }
    }
}
