import AppKit
import SwiftUI

/// The References tab: the project's sources, and the document's bibliography.
///
/// Built for speed first. The field at the top takes anything — a URL, a DOI, an ISBN,
/// an arXiv id, a PMID, or a title — and ⏎ adds it: the source appears at once and
/// fills itself in when the lookup returns. The same field filters the list as it is
/// typed into, and in cite mode (Insert ▸ Insert Citation…, ⌥⌘K) ⏎ cites the
/// highlighted source instead, or adds and cites what was typed when nothing matches.
///
/// Everything shown is what the page published (`referencesChanged`), formatted by the
/// same citeproc run that formats the document; every edit is a command.
struct ReferencesPanelView: View {
    @Environment(AppModel.self) private var model

    enum Scope: String, CaseIterable, Identifiable {
        case document = "This Document"
        case project = "All in Project"
        var id: String { rawValue }
    }

    @State private var scope: Scope = .document
    @State private var input = ""
    @State private var highlighted: String?
    @State private var expanded: String?
    @FocusState private var quickAddFocused: Bool

    var body: some View {
        let sidebar = model.sidebar
        let state = sidebar.references
        VStack(spacing: 0) {
            quickAdd
            controls(state)
            Divider()
            list(state)
            if state?.docPath != nil { Divider(); BibliographyFooter() }
        }
        .onChange(of: sidebar.quickAddRequest) { _, _ in quickAddFocused = true }
        .onChange(of: sidebar.focusedReferenceId) { _, id in
            guard let id else { return }
            expanded = id
            // A source ⌥-clicked in another document still shows, whatever the scope.
            if state?.references.first(where: { $0.reference.id == id })?.attached == false { scope = .project }
        }
        .onAppear { if sidebar.quickAddRequest > 0 { quickAddFocused = true } }
    }

    /* ---------------- quick add ---------------- */

    private var quickAdd: some View {
        let sidebar = model.sidebar
        let matches = matching(sidebar.references)
        return HStack(spacing: 6) {
            Image(systemName: sidebar.citing ? "quote.opening" : "plus.magnifyingglass")
                .foregroundStyle(sidebar.citing ? Color.accentColor : .secondary)
            TextField(sidebar.citing ? "Find a source to cite…" : "Paste a URL, DOI or ISBN — or type a title", text: $input)
                .textFieldStyle(.plain)
                .focused($quickAddFocused)
                .onSubmit { submit(matches) }
                .onKeyPress(.downArrow) { move(1, in: matches); return .handled }
                .onKeyPress(.upArrow) { move(-1, in: matches); return .handled }
                .onKeyPress(.escape) {
                    if sidebar.citing || !input.isEmpty {
                        input = ""
                        sidebar.citing = false
                        return .handled
                    }
                    return .ignored
                }
                .onChange(of: input) { _, _ in highlighted = matching(sidebar.references).first?.reference.id }
            if !input.isEmpty {
                Button { input = "" } label: { Image(systemName: "xmark.circle.fill") }
                    .buttonStyle(.borderless)
                    .foregroundStyle(.secondary)
                    .help("Clear")
            }
            newSourceMenu
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(RoundedRectangle(cornerRadius: 8).fill(.background.secondary))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(sidebar.citing ? Color.accentColor.opacity(0.6) : .clear))
        .padding(.horizontal, 12)
        .padding(.top, 10)
        .padding(.bottom, 6)
    }

    private var newSourceMenu: some View {
        let kinds = model.sidebar.referenceSchema?.kinds ?? []
        let groups = kinds.reduce(into: [String]()) { if !$0.contains($1.group) { $0.append($1.group) } }
        return Menu {
            ForEach(groups, id: \.self) { group in
                Section(group) {
                    ForEach(kinds.filter { $0.group == group }, id: \.id) { kind in
                        Button { expanded = model.sidebar.createReference(kind: kind.id) } label: {
                            Label(kind.label, systemImage: kind.symbol)
                        }
                    }
                }
            }
        } label: {
            Image(systemName: "square.and.pencil")
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .fixedSize()
        .help("Enter a source by hand")
    }

    private func matching(_ state: ReferencesChanged?) -> [ReferenceView] {
        let needle = input.trimmingCharacters(in: .whitespaces).lowercased()
        let all = visible(state)
        guard !needle.isEmpty else { return model.sidebar.citing ? all : [] }
        return all.filter { view in
            (view.entryText + " " + view.inText + " " + view.reference.note + " " + view.reference.tags.joined(separator: " "))
                .lowercased().contains(needle)
        }
    }

    private func move(_ step: Int, in matches: [ReferenceView]) {
        guard !matches.isEmpty else { return }
        let current = matches.firstIndex { $0.reference.id == highlighted } ?? -1
        highlighted = matches[max(0, min(matches.count - 1, current + step))].reference.id
    }

    private func submit(_ matches: [ReferenceView]) {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        let sidebar = model.sidebar
        if sidebar.citing {
            if let id = highlighted ?? matches.first?.reference.id {
                sidebar.cite([id])
            } else if !text.isEmpty {
                sidebar.addReference(text, cite: true)
            } else {
                return
            }
            input = ""
            sidebar.citing = false
            model.focusDocument()
            return
        }
        guard !text.isEmpty else { return }
        expanded = sidebar.addReference(text)
        input = ""
    }

    /* ---------------- style and scope ---------------- */

    private func controls(_ state: ReferencesChanged?) -> some View {
        let sidebar = model.sidebar
        let styles = sidebar.referenceSchema?.styles ?? []
        let current = styles.first { $0.id == state?.style }
        return HStack(spacing: 8) {
            Menu {
                ForEach(styles, id: \.id) { style in
                    Toggle(style.label, isOn: Binding(
                        get: { state?.style == style.id },
                        set: { if $0 { sidebar.setCitationStyle(style.id) } }))
                }
                Divider()
                Button("Use \(current?.short ?? "This Style") for New Documents") {
                    if let current { sidebar.setCitationStyle(current.id, projectDefault: true) }
                }
                .disabled(current == nil || state?.projectStyle == current?.id)
            } label: {
                Label(current?.short ?? "Style", systemImage: "textformat")
            }
            .menuStyle(.button)
            .buttonStyle(.bordered)
            .controlSize(.small)
            .fixedSize()
            .help("Citation style — ⌃⌘[ and ⌃⌘] step through them")

            Picker("Show", selection: $scope) {
                ForEach(Scope.allCases) { Text($0 == .document ? "Document" : "Project").tag($0) }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .controlSize(.small)
            .disabled(state?.docPath == nil)
        }
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
    }

    /* ---------------- the list ---------------- */

    private func visible(_ state: ReferencesChanged?) -> [ReferenceView] {
        guard let state else { return [] }
        let all = state.references.filter { model.sidebar.matchesFilter($0.entryText, $0.reference.note, $0.reference.annotation) }
        guard scope == .document, state.docPath != nil else { return all }
        return all.filter { $0.attached || $0.cited }
    }

    @ViewBuilder
    private func list(_ state: ReferencesChanged?) -> some View {
        let shown = input.isEmpty ? visible(state) : matching(state)
        if shown.isEmpty {
            ContentUnavailableView {
                Label(emptyTitle(state), systemImage: "books.vertical")
            } description: {
                Text(emptyMessage(state))
            }
            .frame(maxHeight: .infinity)
        } else {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 8) {
                        ForEach(shown, id: \.reference.id) { view in
                            ReferenceRowView(
                                view: view,
                                scope: scope,
                                highlighted: highlighted == view.reference.id && !input.isEmpty,
                                expanded: Binding(
                                    get: { expanded == view.reference.id },
                                    set: { expanded = $0 ? view.reference.id : nil }))
                            .id(view.reference.id)
                        }
                    }
                    .padding(12)
                }
                .onChange(of: model.sidebar.focusedReferenceId) { _, id in
                    guard let id else { return }
                    withAnimation { proxy.scrollTo(id, anchor: .top) }
                    model.sidebar.focusedReferenceId = nil
                }
                .onChange(of: highlighted) { _, id in if let id { proxy.scrollTo(id) } }
            }
        }
    }

    private func emptyTitle(_ state: ReferencesChanged?) -> String {
        if !input.isEmpty { return "No Matching Sources" }
        if state == nil { return "No Project Open" }
        return scope == .document && state?.docPath != nil ? "No Sources in This Document" : "No Sources Yet"
    }

    private func emptyMessage(_ state: ReferencesChanged?) -> String {
        if !input.isEmpty { return model.sidebar.citing ? "Press Return to add “\(input)” and cite it." : "Press Return to look it up and add it." }
        if state == nil { return "" }
        return "Paste a link, DOI or ISBN above, or type a title. Sources you add here belong to the document you are in."
    }
}

/* ---------------- one source ---------------- */

private struct ReferenceRowView: View {
    @Environment(AppModel.self) private var model
    let view: ReferenceView
    let scope: ReferencesPanelView.Scope
    let highlighted: Bool
    @Binding var expanded: Bool
    @State private var hovering = false
    @State private var confirmingDelete = false

    private var reference: Reference { view.reference }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 8) {
                kindIcon
                VStack(alignment: .leading, spacing: 4) {
                    entry
                    badges
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
                .onTapGesture { withAnimation(.snappy) { expanded.toggle() } }
                .onTapGesture(count: 2) { cite() }
                actions
            }
            if expanded {
                ReferenceEditorView(view: view)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 10).fill(highlighted ? AnyShapeStyle(Color.accentColor.opacity(0.15)) : AnyShapeStyle(.background.secondary)))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(expanded ? Color.accentColor.opacity(0.5) : .clear))
        .onHover { hovering = $0 }
        .contextMenu { menuItems }
        .draggable(view.inText.isEmpty ? reference.title : view.inText)
        .confirmationDialog("Delete this source?", isPresented: $confirmingDelete) {
            Button("Delete", role: .destructive) { model.sidebar.deleteReference(reference.id) }
        } message: {
            Text(view.cited
                 ? "It is cited in this document. Its citations will show as a missing source."
                 : "It will be removed from every document in the project.")
        }
    }

    private func cite() {
        model.sidebar.cite([reference.id])
        model.focusDocument()
    }

    private var kindIcon: some View {
        let symbol = model.sidebar.referenceSchema?.kinds.first { $0.id == reference.kind }?.symbol ?? "doc"
        return Image(systemName: symbol)
            .foregroundStyle(.secondary)
            .frame(width: 18)
            .padding(.top, 2)
    }

    @ViewBuilder
    private var entry: some View {
        if reference.status == .resolving && view.entryHtml.isEmpty || reference.status == .resolving && reference.title.isEmpty {
            HStack(spacing: 6) {
                ProgressView().controlSize(.small)
                Text("Looking up \(reference.origin?.input ?? "source")…")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        } else if view.entryHtml.isEmpty {
            Text(reference.title.isEmpty ? "Untitled source" : reference.title).font(.callout)
        } else {
            Text(ReferenceText.attributed(view.entryHtml))
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder
    private var badges: some View {
        let chips = badgeList
        if !chips.isEmpty {
            HStack(spacing: 6) {
                ForEach(chips, id: \.text) { chip in
                    Label(chip.text, systemImage: chip.symbol)
                        .font(.caption2)
                        .labelStyle(.titleAndIcon)
                        .foregroundStyle(chip.color)
                        .lineLimit(1)
                }
            }
        }
    }

    private struct Badge { let text: String; let symbol: String; let color: Color }

    private var badgeList: [Badge] {
        var out: [Badge] = []
        switch reference.status {
        case .resolving:
            out.append(Badge(text: "Looking up", symbol: "arrow.triangle.2.circlepath", color: .secondary))
        case .failed:
            out.append(Badge(text: "Not found", symbol: "exclamationmark.triangle.fill", color: .orange))
        case .incomplete where !reference.candidates.isEmpty:
            out.append(Badge(text: "Choose a match", symbol: "list.bullet", color: .accentColor))
        case .incomplete:
            out.append(Badge(text: "Missing \(view.missingFields.count)", symbol: "exclamationmark.circle", color: .orange))
        case .complete:
            break
        }
        if view.cited { out.append(Badge(text: "Cited", symbol: "quote.opening", color: .accentColor)) }
        if scope == .project && !view.usedIn.isEmpty {
            let names = view.usedIn.map { $0.split(separator: "/").last.map(String.init) ?? $0 }
            out.append(Badge(text: names.count == 1 ? names[0] : "\(names.count) documents", symbol: "doc.text", color: .secondary))
        }
        if !reference.note.isEmpty { out.append(Badge(text: "Note", symbol: "note.text", color: .secondary)) }
        if !reference.annotation.isEmpty { out.append(Badge(text: "Annotated", symbol: "text.append", color: .secondary)) }
        return out
    }

    private var actions: some View {
        HStack(spacing: 2) {
            Button { cite() } label: { Image(systemName: "quote.opening") }
                .help("Cite at the caret (or double-click the source)")
                .disabled(model.sidebar.target == nil)
            Menu { menuItems } label: { Image(systemName: "ellipsis") }
                .menuStyle(.borderlessButton)
                .menuIndicator(.hidden)
                .fixedSize()
        }
        .buttonStyle(.borderless)
        .opacity(hovering || expanded || highlighted ? 1 : 0.35)
    }

    @ViewBuilder
    private var menuItems: some View {
        let sidebar = model.sidebar
        Button("Cite") { cite() }
            .disabled(sidebar.target == nil)
        Button(expanded ? "Done Editing" : "Edit") { expanded.toggle() }
        Divider()
        if let url = reference.sourceURL {
            Button("Open Source") { NSWorkspace.shared.open(url) }
        }
        Button("Copy Entry") { ReferenceText.copy(html: view.entryHtml, plain: view.entryText) }
            .disabled(view.entryHtml.isEmpty)
        Button("Copy In-Text Citation") {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(view.inText, forType: .string)
        }
        .disabled(view.inText.isEmpty)
        if sidebar.references?.docPath != nil {
            Divider()
            if view.attached {
                Button("Remove from This Document") { sidebar.setAttached(reference.id, false) }
                    .disabled(view.cited)
            } else {
                Button("Add to This Document") { sidebar.setAttached(reference.id, true) }
            }
        }
        if reference.origin?.input.isEmpty == false {
            Button("Look Up Again") { sidebar.retryLookup(reference.id) }
        }
        Divider()
        Button("Delete…", role: .destructive) { confirmingDelete = true }
    }
}

/* ---------------- the bibliography ---------------- */

private struct BibliographyFooter: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let sidebar = model.sidebar
        if let state = sidebar.references {
            let options = state.bibliography
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Bibliography").font(.headline)
                    Spacer()
                    Button(state.hasBibliography ? "Move to End" : "Insert at End") { sidebar.insertBibliography() }
                        .controlSize(.small)
                        .disabled(sidebar.target == nil)
                        .help(state.hasBibliography
                              ? "Move the live bibliography to the end of the document"
                              : "Add a live bibliography at the end of the document — it updates as you cite")
                }
                Picker("List", selection: Binding(
                    get: { options.include },
                    set: { value in sidebar.setBibliographyOptions { $0.include = value } })) {
                    Text("Sources cited in the text").tag(BibliographyInclude.cited)
                    Text("Every source in this document").tag(BibliographyInclude.attached)
                }
                .pickerStyle(.menu)
                .controlSize(.small)
                Toggle("Annotated (show each source’s annotation)", isOn: Binding(
                    get: { options.annotated },
                    set: { value in sidebar.setBibliographyOptions { $0.annotated = value } }))
                    .controlSize(.small)
                Toggle("Add to printouts and exports", isOn: Binding(
                    get: { state.hasBibliography || options.inPrint },
                    set: { value in sidebar.setBibliographyOptions { $0.inPrint = value } }))
                    .controlSize(.small)
                    .disabled(state.hasBibliography)
                    .help(state.hasBibliography
                          ? "The bibliography is in the document, so it prints with it"
                          : "Print and export this document with its bibliography at the end, without one in the text")
            }
            .padding(12)
        }
    }
}
