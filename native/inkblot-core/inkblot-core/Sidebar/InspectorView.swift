import SwiftUI

/// The right sidebar: one search bar over four panels, as the page's was.
///
/// With the scope on "This Panel" the bar filters the panel beneath it. Any other scope
/// turns it into a search, and the results replace the panel until the scope goes back
/// — the two never fight over the same list.
struct InspectorView: View {
    @Environment(AppModel.self) private var model
    @State private var replacement = ""

    var body: some View {
        @Bindable var sidebar = model.sidebar

        VStack(spacing: 0) {
            searchBar
                .padding(.horizontal, 12)
                .padding(.top, 10)

            Picker("Panel", selection: $sidebar.tab) {
                ForEach(SidebarModel.Tab.allCases) { tab in
                    Label(tab.title, systemImage: tab.symbol).tag(tab)
                }
            }
            .pickerStyle(.segmented)
            .labelStyle(.iconOnly)
            .padding(12)
            .disabled(sidebar.isSearching)

            Divider()

            Group {
                if sidebar.isSearching {
                    SearchResultsView(replacement: $replacement)
                } else {
                    switch sidebar.tab {
                    case .clipboard: ClipboardPanelView()
                    case .workbench: WorkbenchPanelView()
                    case .notes: NotesPanelView()
                    case .history: HistoryPanelView()
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
    }

    private var searchBar: some View {
        @Bindable var sidebar = model.sidebar
        return VStack(spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField(placeholder, text: $sidebar.query)
                    .textFieldStyle(.plain)
                    .onSubmit { sidebar.runSearch() }
                if !sidebar.query.isEmpty {
                    Button { sidebar.query = "" } label: { Image(systemName: "xmark.circle.fill") }
                        .buttonStyle(.borderless)
                        .foregroundStyle(.secondary)
                }
                Menu {
                    Picker("Search", selection: $sidebar.scope) {
                        Text("This Panel").tag(SearchScope.panel)
                        Text("This Document").tag(SearchScope.document)
                        Text("Notes").tag(SearchScope.notes)
                        Text("File Names").tag(SearchScope.files)
                        Text("Whole Project").tag(SearchScope.project)
                    }
                    .pickerStyle(.inline)
                    Divider()
                    Toggle("Match Case", isOn: $sidebar.matchCase)
                    Toggle("Whole Word", isOn: $sidebar.wholeWord)
                    Toggle("Regular Expression", isOn: $sidebar.useRegex)
                } label: {
                    Image(systemName: "line.3.horizontal.decrease.circle")
                }
                .menuStyle(.borderlessButton)
                .menuIndicator(.hidden)
                .fixedSize()
                .help("Where to search, and how to match")
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .glassEffect(.regular, in: .capsule)

            if sidebar.scope != .panel {
                HStack {
                    Text(scopeLabel).font(.caption).foregroundStyle(.secondary)
                    Spacer()
                }
            }
        }
        .onChange(of: sidebar.query) { sidebar.runSearch() }
        .onChange(of: sidebar.scope) { sidebar.runSearch() }
        .onChange(of: sidebar.matchCase) { sidebar.runSearch() }
        .onChange(of: sidebar.wholeWord) { sidebar.runSearch() }
        .onChange(of: sidebar.useRegex) { sidebar.runSearch() }
    }

    private var placeholder: String {
        switch model.sidebar.scope {
        case .panel: "Filter \(model.sidebar.tab.title.lowercased())"
        case .document: "Search this document"
        case .notes: "Search notes"
        case .files: "Search file names"
        case .project: "Search the project"
        }
    }

    private var scopeLabel: String {
        let count = model.sidebar.results.count
        return "\(count) result\(count == 1 ? "" : "s")"
    }
}

/// What a scope other than "This Panel" found.
struct SearchResultsView: View {
    @Environment(AppModel.self) private var model
    @Binding var replacement: String

    var body: some View {
        let sidebar = model.sidebar
        VStack(spacing: 0) {
            if sidebar.scope == .document {
                HStack {
                    TextField("Replace with", text: $replacement)
                        .textFieldStyle(.roundedBorder)
                    Button("Replace All") { sidebar.replaceAll(with: replacement) }
                        .disabled(sidebar.results.isEmpty)
                }
                .padding(12)
            }

            if let error = sidebar.searchError {
                ContentUnavailableView("Invalid Search", systemImage: "exclamationmark.magnifyingglass",
                                       description: Text(error))
            } else if sidebar.results.isEmpty {
                ContentUnavailableView(
                    sidebar.query.isEmpty ? "Type to Search" : "No Results",
                    systemImage: "magnifyingglass")
            } else {
                List(sidebar.results, id: \.id) { result in
                    Button { sidebar.reveal(result) } label: {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(result.title).font(.headline).lineLimit(1)
                            Text(result.preview).font(.callout).foregroundStyle(.secondary).lineLimit(3)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                }
                .listStyle(.inset)
            }
        }
    }
}
