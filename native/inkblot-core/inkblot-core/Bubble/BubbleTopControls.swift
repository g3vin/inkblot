import AppKit
import SwiftUI

extension Animation {
    /// For regrouping, splitting and merging bubbles: a curve that ends when it says it
    /// does. Under a spring, a bubble going away shrinks to a speck and then waits out the
    /// spring's long settling tail before it is removed.
    static let bubbleRegrouping = Animation.easeOut(duration: 0.24)
}

/// The bubble editor's controls, at the top of the window while a session is open: which
/// grouping (Sentences, Clauses, Words), Archive, and Done as a green circle of its own.
/// The window toolbar is hidden meanwhile, so they take their clicks in its row.
struct BubbleTopControls: View {
    let bubble: BubbleModel

    var body: some View {
        HStack(spacing: 10) {
            bar
            Button { bubble.close(archive: false) } label: {
                Image(systemName: "checkmark")
                    .resizable()
                    .scaledToFit()
                    .fontWeight(.bold)
                    .frame(width: 16, height: 16)
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .contentShape(.circle)
            }
            .buttonStyle(.plain)
            .glassEffect(.regular.tint(.green).interactive(), in: .circle)
            .keyboardShortcut(.return, modifiers: .command)
            .help("Done — write the sentence into the document and keep this session (⌘↩)")
            .accessibilityLabel("Done")
        }
    }

    private var bar: some View {
        HStack(spacing: 8) {
            HStack(spacing: 2) {
                modeButton("Sentences", .sentences)
                modeButton("Clauses", .clauses)
                modeButton("Words", .words)
            }
            .padding(2)
            .background(.quaternary.opacity(0.5), in: .capsule)

            Button { bubble.close(archive: true) } label: {
                Label("Archive", systemImage: "archivebox")
            }
            // The icon alone; the name is for VoiceOver and the tooltip.
            .labelStyle(.iconOnly)
            .buttonStyle(.glass)
            .buttonBorderShape(.circle)
            .help("Write the sentence into the document and archive this session — restore it from History ▸ Archive")
        }
        .padding(6)
        .glassEffect(.regular, in: .capsule)
    }

    /// Buttons rather than a segmented picker: choosing Words again re-splits a sentence
    /// whose words were joined, and a picker does not report a re-selection.
    private func modeButton(_ title: String, _ mode: BubbleMode) -> some View {
        Button {
            withAnimation(.bubbleRegrouping) { bubble.regroup(mode) }
        } label: {
            Text(title)
                .font(.system(size: 12.5, weight: .medium))
                .padding(.horizontal, 12)
                .padding(.vertical, 5)
                .background(bubble.mode == mode ? AnyShapeStyle(.background.opacity(0.7)) : AnyShapeStyle(.clear),
                            in: .capsule)
                .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .foregroundStyle(bubble.mode == mode ? .primary : .secondary)
    }
}

/// The traffic lights, drawn by the bubble editor while the window toolbar is hidden.
///
/// Hiding the toolbar hides the whole titlebar, lights included. AppKit makes standard
/// window buttons for any view (`NSWindow.standardWindowButton(_:for:)`), and they close,
/// minimize and zoom the window they end up in; these are placed exactly where the
/// window's own are, which do not move while hidden.
struct BubbleWindowButtons: NSViewRepresentable {
    func makeNSView(context: Context) -> ButtonsView { ButtonsView() }
    func updateNSView(_ view: ButtonsView, context: Context) {}

    final class ButtonsView: NSView {
        private static let kinds: [NSWindow.ButtonType] = [.closeButton, .miniaturizeButton, .zoomButton]

        override var isFlipped: Bool { true }

        /// Only the buttons take clicks; everywhere else belongs to the editor.
        override func hitTest(_ point: NSPoint) -> NSView? {
            let hit = super.hitTest(point)
            return hit === self ? nil : hit
        }

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            needsLayout = true
        }

        override func layout() {
            super.layout()
            guard let window else { return }
            for (index, kind) in Self.kinds.enumerated() {
                guard let original = window.standardWindowButton(kind) else { continue }
                let frame = convert(original.convert(original.bounds, to: nil), from: nil)
                if index < subviews.count {
                    subviews[index].frame = frame
                } else if let button = NSWindow.standardWindowButton(kind, for: window.styleMask) {
                    button.frame = frame
                    addSubview(button)
                }
            }
        }
    }
}
