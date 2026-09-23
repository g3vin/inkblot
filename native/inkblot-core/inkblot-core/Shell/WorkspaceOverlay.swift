import SwiftUI

/// The tab dock, the new-tab chooser and the Analytic Bubble, over the web view.
///
/// The same layer the note cards use (`NotePreviewOverlay`), for the same reasons: glass
/// has to be over the document to refract it, and the page's coordinates are this
/// layer's coordinates, so a rectangle the page reports can be drawn into directly.
/// Only the controls are hit-testable; everything else reaches the page underneath.
struct WorkspaceOverlay: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let workspace = model.workspace
        GeometryReader { proxy in
            ZStack(alignment: .topLeading) {
                if let draft = workspace.draft, let rect = draft.rect?.cgRect, rect.width > 0 {
                    DraftChooserView(draft: draft)
                        .frame(maxWidth: min(440, rect.width - 32))
                        .position(x: rect.midX, y: rect.midY)
                        .transition(.opacity.combined(with: .scale(scale: 0.97)))
                }

                if let sentence = workspace.sentence {
                    SentenceBubbleView(structure: sentence, viewport: proxy.size)
                        .transition(.opacity.combined(with: .scale(scale: 0.95, anchor: .topLeading)))
                }

                if workspace.tabs != nil {
                    TabDockView()
                        .frame(maxWidth: .infinity)
                        .position(x: proxy.size.width / 2, y: proxy.size.height - 30)
                }
            }
            .animation(.spring(duration: 0.25), value: workspace.draft?.tabId)
            .animation(.spring(duration: 0.25), value: workspace.sentence?.sentence)
        }
    }
}

/* ---------------- the tab dock ---------------- */

/// `TabDock.jsx`: a row of dots, one per tab, that opens into named pills on hover. A
/// tab on screen keeps its name either way — filled in the primary pane, ringed in the
/// secondary. A document dragged from the file tree opens the dock and drops into a tab.
struct TabDockView: View {
    @Environment(AppModel.self) private var model
    @State private var hovered = false
    @State private var dropTargeted = false

    var body: some View {
        let workspace = model.workspace
        let tabs = workspace.tabs?.tabs ?? []
        let expanded = hovered || dropTargeted

        HStack(spacing: 4) {
            if tabs.isEmpty {
                Text("Drag a file here to open it in a tab")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 6)
            }
            ForEach(tabs, id: \.id) { tab in
                TabPill(tab: tab, presentation: workspace.presentation(of: tab), expanded: expanded)
            }
            Button { workspace.newTab() } label: {
                Image(systemName: "plus")
                    .font(.system(size: 12, weight: .semibold))
                    .frame(width: 24, height: 24)
                    .contentShape(.circle)
            }
            .buttonStyle(.plain)
            .help("New Tab")
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .glassEffect(.regular.interactive(), in: .capsule)
        .overlay {
            Capsule().strokeBorder(Color.accentColor, lineWidth: 2).opacity(dropTargeted ? 1 : 0)
        }
        .fixedSize()
        .onHover { hovered = $0 }
        .dropDestination(for: String.self) { paths, _ in
            let documents = paths.filter { model.tree.filePaths.contains($0) }
            for path in documents { workspace.openInTab(path) }
            return !documents.isEmpty
        } isTargeted: { dropTargeted = $0 }
        .animation(.spring(duration: 0.25), value: expanded)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Open documents")
    }
}

private struct TabPill: View {
    @Environment(AppModel.self) private var model
    let tab: DocTab
    let presentation: WorkspaceModel.TabPresentation
    let expanded: Bool

    var body: some View {
        let workspace = model.workspace
        let showsName = expanded || presentation.isOpen

        HStack(spacing: 5) {
            Button { workspace.select(tab) } label: {
                if showsName {
                    HStack(spacing: 5) {
                        Image(systemName: presentation.symbol).font(.system(size: 11))
                        Text(presentation.label)
                            .font(.callout)
                            .lineLimit(1)
                            .italic(tab.ephemeral == true)
                    }
                    .padding(.horizontal, 8)
                    .frame(height: 24)
                    .background(
                        Capsule().fill(presentation.isActive ? Color.accentColor.opacity(0.22) : .clear))
                    .overlay(
                        Capsule().strokeBorder(Color.accentColor.opacity(presentation.inSecondary ? 0.8 : 0), lineWidth: 1))
                } else {
                    Circle()
                        .fill(presentation.isActive ? Color.primary : Color.secondary.opacity(0.5))
                        .overlay(Circle().strokeBorder(Color.accentColor, lineWidth: presentation.inSecondary ? 1.5 : 0))
                        .frame(width: 7, height: 7)
                        .frame(width: 14, height: 24)
                }
            }
            .buttonStyle(.plain)
            .contentShape(.rect)
            .help(tab.docPath ?? "New tab")

            if expanded {
                Button { workspace.close(tab) } label: {
                    Image(systemName: "xmark").font(.system(size: 9, weight: .semibold))
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .help("Close Tab")
                .accessibilityLabel("Close \(presentation.label)")
            }
        }
        .contextMenu {
            Button("Close Tab") { workspace.close(tab) }
        }
        .accessibilityAddTraits(presentation.isActive ? .isSelected : [])
    }
}

/* ---------------- the new-tab chooser ---------------- */

/// `DraftTabPane.jsx`: pick a kind, name it, create. The page checks the name and makes
/// the file; a refusal comes back as `status`.
struct DraftChooserView: View {
    @Environment(AppModel.self) private var model
    let draft: DraftPaneChanged
    @State private var kind: DraftKind = .doc
    @State private var name = ""
    @FocusState private var nameFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                kindButton(.doc, label: "Document", symbol: "doc.text", hint: "A page for writing")
                kindButton(.canvas, label: "Canvas", symbol: "rectangle.3.group", hint: "An open board for cards")
            }

            HStack(spacing: 8) {
                TextField(kind == .canvas ? "Canvas name" : "Document name", text: $name)
                    .textFieldStyle(.roundedBorder)
                    .focused($nameFocused)
                    .onSubmit(create)
                Button("Create", action: create)
                    .buttonStyle(.glassProminent)
                    .disabled(draft.creating == true)
                    .keyboardShortcut(.defaultAction)
            }

            if let status = draft.status, !status.isEmpty {
                Text(status).font(.callout).foregroundStyle(.red)
            }

            Text("Or drag a file from the sidebar onto the dock below to open it in this tab bar.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(18)
        .glassEffect(.regular, in: .rect(cornerRadius: 18))
        .onAppear { nameFocused = true }
        .onChange(of: draft.tabId) { name = ""; kind = .doc }
    }

    private func kindButton(_ option: DraftKind, label: String, symbol: String, hint: String) -> some View {
        Button { kind = option } label: {
            VStack(spacing: 4) {
                Image(systemName: symbol).font(.system(size: 22, weight: .light))
                Text(label).font(.headline)
                Text(hint).font(.caption).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(RoundedRectangle(cornerRadius: 12)
                .fill(kind == option ? Color.accentColor.opacity(0.18) : Color.primary.opacity(0.04)))
            .overlay(RoundedRectangle(cornerRadius: 12)
                .strokeBorder(kind == option ? Color.accentColor : .clear, lineWidth: 1.5))
            .contentShape(.rect(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(kind == option ? .isSelected : [])
    }

    private func create() {
        guard draft.creating != true else { return }
        model.workspace.create(name: name, kind: kind)
    }
}

/* ---------------- the Analytic Bubble ---------------- */

/// `Bubble.jsx`: the sentence's best parses as trees, beside where it was right-clicked.
struct SentenceBubbleView: View {
    @Environment(AppModel.self) private var model
    let structure: SentenceStructure
    let viewport: CGSize
    @State private var shown = 0

    private let width: CGFloat = 520
    private let height: CGFloat = 340

    var body: some View {
        let parses = structure.parses
        let index = min(shown, max(parses.count - 1, 0))

        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text("“\(structure.sentence)”")
                    .font(.callout.italic())
                    .lineLimit(2)
                Spacer(minLength: 8)
                Button { model.workspace.sentence = nil } label: {
                    Image(systemName: "xmark").font(.system(size: 10, weight: .semibold))
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .help("Close")
            }

            if parses.isEmpty {
                Text("No parses found.").foregroundStyle(.secondary)
            } else {
                if parses.count > 1 {
                    Picker("Parse", selection: $shown) {
                        ForEach(parses.indices, id: \.self) { i in Text("Parse \(i + 1)").tag(i) }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                }
                Text("Score \(parses[index].score, format: .number.precision(.fractionLength(3)))")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
                ScrollView([.horizontal, .vertical]) {
                    ParseTreeView(node: parses[index].tree)
                        .padding(4)
                }
            }
        }
        .padding(16)
        .frame(width: width, height: height, alignment: .topLeading)
        .glassEffect(.regular, in: .rect(cornerRadius: 18))
        .offset(origin)
        .onExitCommand { model.workspace.sentence = nil }
        .onChange(of: structure.sentence) { shown = 0 }
    }

    /// Below and right of the right-click, kept inside the web view.
    private var origin: CGSize {
        let anchor = structure.anchor?.cgRect ?? CGRect(x: viewport.width / 2 - width / 2, y: 80, width: 0, height: 0)
        let x = min(max(12, anchor.minX + 8), max(12, viewport.width - width - 12))
        let y = min(max(12, anchor.maxY + 8), max(12, viewport.height - height - 12))
        return CGSize(width: x, height: y)
    }
}

/// A phrase over its children, as the web bubble drew it; a leaf is its label alone.
private struct ParseTreeView: View {
    let node: ParseNode

    var body: some View {
        if (node.children ?? []).isEmpty {
            Text(node.label)
                .font(.callout.monospaced())
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(Capsule().fill(Color.primary.opacity(0.06)))
        } else {
            VStack(spacing: 6) {
                Text(node.label)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.accentColor)
                HStack(alignment: .top, spacing: 10) {
                    ForEach(Array((node.children ?? []).enumerated()), id: \.offset) { _, child in
                        AnyView(ParseTreeView(node: child))
                    }
                }
                .padding(.top, 4)
                .overlay(alignment: .top) {
                    Rectangle().fill(Color.secondary.opacity(0.3)).frame(height: 1).padding(.horizontal, 8)
                }
            }
        }
    }
}
