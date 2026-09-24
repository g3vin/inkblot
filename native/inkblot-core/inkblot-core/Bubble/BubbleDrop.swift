import CoreGraphics
import Foundation

/// Where a dragged bubble lands, and what landing there does — the page's
/// `lib/bubbleDrop.js`, in points. Coordinates are the bubble editor's own, origin at its
/// top left.
enum BubbleDrop {
    /// How close to an edge a drop sets the bubble aside.
    static let edgeBand: CGFloat = 88
    /// How far a set-aside bubble rests from the edge it was put against.
    static let edgeMargin: CGFloat = 18
    /// Set-aside bubbles rest below the editor's controls and the traffic lights.
    static let topClearance: CGFloat = 76
    static let rowGap: CGFloat = 12

    enum Target: Equatable {
        /// Between two bubbles of the sentence. `caret` is where to draw the insertion bar.
        case insert(index: Int, caret: CGRect)
        /// Onto another bubble: one bubble of both, the dragged one first if `before`.
        case join(id: String, before: Bool)
        /// Out of the sentence, resting at this fraction of the editor.
        case aside(x: Double, y: Double)
        case trash
    }

    /// The sentence and the set-aside bubbles, as they are edited.
    struct Arrangement: Equatable {
        var words: [BubbleWord]
        var aside: [BubbleAside]

        func text(of id: String) -> String? {
            words.first { $0.id == id }?.text ?? aside.first { $0.id == id }?.text
        }

        func without(_ id: String) -> Arrangement {
            Arrangement(words: words.filter { $0.id != id }, aside: aside.filter { $0.id != id })
        }
    }

    /// What a drop does to the arrangement.
    static func apply(_ target: Target, dragging id: String, to arrangement: Arrangement) -> Arrangement {
        guard let text = arrangement.text(of: id) else { return arrangement }
        var rest = arrangement.without(id)
        switch target {
        case .trash:
            break
        case .aside(let x, let y):
            rest.aside.append(BubbleAside(id: id, text: text, x: min(1, max(0, x)), y: min(1, max(0, y))))
        case .join(let targetId, let before):
            let merge = { (other: String) in before ? BubbleText.join(text, other) : BubbleText.join(other, text) }
            rest.words = rest.words.map { $0.id == targetId ? BubbleWord(id: $0.id, text: merge($0.text)) : $0 }
            rest.aside = rest.aside.map {
                $0.id == targetId ? BubbleAside(id: $0.id, text: merge($0.text), x: $0.x, y: $0.y) : $0
            }
        case .insert(let index, _):
            rest.words.insert(BubbleWord(id: id, text: text), at: min(max(0, index), rest.words.count))
        }
        return rest
    }

    static func nearEdge(_ stage: CGSize, _ point: CGPoint) -> Bool {
        point.x < edgeBand || stage.width - point.x < edgeBand
            || point.y < edgeBand || stage.height - point.y < edgeBand
    }

    /// How far past a gap's edges a pinch still counts as over it.
    static let gapReach: CGFloat = 16

    /// The gap in the sentence a point is over, as the index of the bubble before it. Only
    /// between two bubbles on one line; where two gaps are in reach, the nearer.
    static func gapAt(_ row: [(id: String, frame: CGRect)], _ point: CGPoint) -> Int? {
        var best: (index: Int, distance: CGFloat)?
        for index in row.indices.dropLast() {
            let a = row[index].frame, b = row[index + 1].frame
            guard abs(a.midY - b.midY) <= a.height / 2,
                  point.y >= min(a.minY, b.minY) - 8, point.y <= max(a.maxY, b.maxY) + 8,
                  point.x >= a.maxX - gapReach, point.x <= b.minX + gapReach else { continue }
            let distance = abs(point.x - (a.maxX + b.minX) / 2)
            if best == nil || distance < best!.distance { best = (index, distance) }
        }
        return best?.index
    }

    /// How close two bubbles' edges must come to count as touching.
    static let touchSlack: CGFloat = 4

    /// The bubble a dragged bubble (at `rect`) is touching, which a drop joins it to.
    ///
    /// Joining is touching: a bubble brought up against another merges with it, on the
    /// side it touched. One held over the gap between two others touches both and goes
    /// between them instead — unless it is pressed much further into one than the other.
    static func touchTarget(_ rect: CGRect, _ items: [(id: String, frame: CGRect)]) -> Target? {
        var touches: [(id: String, frame: CGRect, weight: CGFloat)] = []
        for item in items {
            let across = min(rect.maxX, item.frame.maxX) - max(rect.minX, item.frame.minX)
            let down = min(rect.maxY, item.frame.maxY) - max(rect.minY, item.frame.minY)
            guard across >= -touchSlack, down >= 0.3 * min(rect.height, item.frame.height) else { continue }
            touches.append((item.id, item.frame, across + touchSlack))
        }
        touches.sort { $0.weight > $1.weight }
        guard let first = touches.first else { return nil }
        if touches.count > 1, first.weight < 2 * touches[1].weight { return nil }
        return .join(id: first.id, before: rect.midX < first.frame.midX)
    }

    /// Where a bubble set aside at `point` rests: against the nearest edge, where it was
    /// put along it. As fractions of the editor.
    static func asidePoint(stage: CGSize, point: CGPoint, size: CGSize) -> (x: Double, y: Double) {
        let halfW = size.width / 2, halfH = size.height / 2
        let minX = edgeMargin + halfW
        let maxX = max(minX, stage.width - edgeMargin - halfW)
        let minY = max(edgeMargin + halfH, topClearance + halfH)
        let maxY = max(minY, stage.height - edgeMargin - halfH)
        let distances: [(Edge, CGFloat)] = [
            (.left, point.x), (.right, stage.width - point.x),
            (.top, point.y), (.bottom, stage.height - point.y),
        ]
        let edge = distances.min { $0.1 < $1.1 }!.0
        var cx = min(max(point.x, minX), maxX)
        var cy = min(max(point.y, minY), maxY)
        switch edge {
        case .left: cx = minX
        case .right: cx = maxX
        case .top: cy = min(maxY, topClearance + halfH)
        case .bottom: cy = maxY
        }
        return (Double(cx / stage.width), Double(cy / stage.height))
    }

    private enum Edge { case left, right, top, bottom }

    /// Which slot of the sentence a point is over. `row` is the sentence's bubbles in order,
    /// without the one being dragged.
    static func insertion(row: [(id: String, frame: CGRect)], rowFrame: CGRect, at point: CGPoint) -> Target {
        guard !row.isEmpty else {
            return .insert(index: 0, caret: CGRect(x: rowFrame.midX, y: rowFrame.minY, width: 0, height: 44))
        }
        struct Line { var top: CGFloat; var bottom: CGFloat; var items: [(index: Int, frame: CGRect)] }
        var lines: [Line] = []
        for (index, item) in row.enumerated() {
            if let at = lines.firstIndex(where: { abs($0.top - item.frame.minY) < item.frame.height / 2 }) {
                lines[at].items.append((index, item.frame))
                lines[at].bottom = max(lines[at].bottom, item.frame.maxY)
            } else {
                lines.append(Line(top: item.frame.minY, bottom: item.frame.maxY, items: [(index, item.frame)]))
            }
        }
        let distance = { (line: Line) -> CGFloat in
            point.y < line.top ? line.top - point.y : point.y > line.bottom ? point.y - line.bottom : 0
        }
        let line = lines.min { distance($0) < distance($1) }!
        if let next = line.items.first(where: { point.x < $0.frame.midX }) {
            return .insert(index: next.index, caret: CGRect(x: next.frame.minX - rowGap / 2, y: next.frame.minY,
                                                            width: 0, height: next.frame.height))
        }
        let last = line.items[line.items.count - 1]
        return .insert(index: last.index + 1, caret: CGRect(x: last.frame.maxX + rowGap / 2, y: last.frame.minY,
                                                           width: 0, height: last.frame.height))
    }
}
