import SwiftUI

/// The Typeset tab's Proof section: what a typesetter fixes on the chapter's pages, and
/// the paragraph the caret is in.
///
/// With the proof on, the pages mark loose lines, widows and orphans, runts, ladders of
/// hyphens and a short last page (`proofIssues.ts`), and this lists them; each offers
/// the fixes a typesetter would reach for — a touch of tracking, keeping lines together,
/// running a page a line long. None of it changes a word: it is typesetting, kept in
/// the typeset history, and printing only.
struct ProofSection: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let layout = model.pageLayout
        FinishingSection("Proof", id: FinishingSectionID.proof) {
            Toggle("Mark Problems on the Pages", isOn: Binding(
                get: { layout.proof },
                set: { layout.setDisplay(proof: $0) }))
            if layout.proof {
                if layout.spread || layout.typesetView == .digital {
                    FinishingNote("The proof reads the chapter’s own pages: show them one at a time, in Print.")
                } else if layout.proofIssues.isEmpty {
                    Label("Nothing to fix on this chapter’s pages.", systemImage: "checkmark.circle")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(layout.proofIssues, id: \.id) { issue in
                        ProofIssueRow(issue: issue, layout: layout)
                    }
                }
            }
            if let paragraph = layout.paragraph {
                ParagraphTypesetControls(paragraph: paragraph, layout: layout)
            }
        } footer: {
            FinishingNote("Fixes change how lines fall, never the words, and print only. Each is in the typeset history.")
        }
    }
}

private struct ProofIssueRow: View {
    let issue: ProofIssue
    let layout: PageLayoutModel

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: Self.symbol(issue.kind))
                .foregroundStyle(Self.tint(issue.kind))
                .frame(width: 16)
            VStack(alignment: .leading, spacing: 2) {
                Text("\(Self.name(issue.kind)) · page \(issue.page)")
                    .font(.callout.weight(.medium))
                Text(issue.anchor.text)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                HStack(spacing: 6) {
                    ForEach(issue.fixes, id: \.self) { fix in
                        Button(Self.fixName(fix)) { layout.fix(issue, fix) }
                            .controlSize(.small)
                    }
                }
            }
        }
        .contentShape(Rectangle())
        .onTapGesture { layout.showProofIssue(issue) }
        .help("Show it on the page")
    }

    static func name(_ kind: ProofKind) -> String {
        switch kind {
        case .loose: "Loose Line"
        case .widow: "Widow"
        case .orphan: "Orphan"
        case .runt: "Runt"
        case .stackedHyphens: "Stacked Hyphens"
        case .shortPage: "Short Last Page"
        }
    }

    static func symbol(_ kind: ProofKind) -> String {
        switch kind {
        case .loose: "arrow.left.and.right.text.vertical"
        case .widow, .orphan: "text.line.first.and.arrowtriangle.forward"
        case .runt: "text.line.last.and.arrowtriangle.forward"
        case .stackedHyphens: "minus.rectangle"
        case .shortPage: "doc.plaintext"
        }
    }

    static func tint(_ kind: ProofKind) -> Color {
        switch kind {
        case .loose: .orange
        case .widow, .orphan: .red
        case .runt: .purple
        case .stackedHyphens: .yellow
        case .shortPage: .blue
        }
    }

    static func fixName(_ fix: ProofFix) -> String {
        switch fix {
        case .tighten: "Tighten"
        case .loosen: "Loosen"
        case .keepTogether: "Keep Together"
        case .keepWithNext: "Keep with Next"
        case .runLong: "Run Page Long"
        case .runShort: "Run Page Short"
        }
    }
}

/// What is set on the paragraph the caret is in.
private struct ParagraphTypesetControls: View {
    let paragraph: ParagraphTypeset
    let layout: PageLayoutModel

    var body: some View {
        LabeledContent("Tracking") {
            HStack(spacing: 4) {
                Button { layout.setParagraph(nudge: -PageLayoutModel.trackingStep) } label: { Image(systemName: "minus") }
                    .disabled(paragraph.tracking <= -10)
                Text(paragraph.tracking == 0 ? "0" : String(format: "%+d", paragraph.tracking))
                    .monospacedDigit()
                    .frame(minWidth: 28)
                Button { layout.setParagraph(nudge: PageLayoutModel.trackingStep) } label: { Image(systemName: "plus") }
                    .disabled(paragraph.tracking >= 10)
            }
            .controlSize(.small)
        }
        .help("Letter-spacing for this paragraph, in thousandths of an em: tighter takes a line back, looser pushes one over")
        Toggle("Keep Lines Together", isOn: Binding(
            get: { paragraph.keepTogether },
            set: { layout.setParagraph(keepTogether: $0) }))
        Toggle("Keep with Next", isOn: Binding(
            get: { paragraph.keepWithNext },
            set: { layout.setParagraph(keepWithNext: $0) }))
        Picker("Its Page Runs", selection: Binding(
            get: { paragraph.pageAdjust },
            set: { layout.setParagraph(pageAdjust: $0) }
        )) {
            Text("A Line Short").tag(Int32(-1))
            Text("As Set").tag(Int32(0))
            Text("A Line Long").tag(Int32(1))
        }
    }
}
