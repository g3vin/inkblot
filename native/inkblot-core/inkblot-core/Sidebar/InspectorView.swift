import SwiftUI

/// The right sidebar: a selector bar and one search bar over five panels.
///
/// With the scope on "This Panel" the bar filters the panel beneath it. Any other scope
/// turns it into a search, and the results replace the panel until the scope goes back
/// — the two never fight over the same list.
struct InspectorView: View {
    @Environment(AppModel.self) private var model
    @State private var replacement = ""

    var body: some View {
        @Bindable var sidebar = model.sidebar

        VStack(spacing: 10) {
            // Xcode's arrangement: the toggle in the toolbar above, the selector bar
            // beneath it, then the panel.
            SidebarTabPicker(
                tabs: SidebarModel.Tab.allCases,
                selection: $sidebar.tab,
                symbol: \.symbol,
                title: \.title)
                .disabled(sidebar.isSearching)
                .opacity(sidebar.isSearching ? 0.5 : 1)

            searchBar

            Group {
                if sidebar.isSearching {
                    SearchResultsView(replacement: $replacement)
                } else {
                    switch sidebar.tab {
                    case .clipboard: ClipboardPanelView()
                    case .workbench: WorkbenchPanelView()
                    case .notes: NotesPanelView()
                    case .references: ReferencesPanelView()
                    case .history: HistoryPanelView()
                    case .page: PagePanelView()
                    }
                }
            }
            .padding(.horizontal, -12)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .padding(.horizontal, 12)
        .padding(.top, 8)
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
                ContentUnavailableView {
                    Text("Invalid Search")
                } description: {
                    Text(error)
                }
                .frame(maxHeight: .infinity)
            } else if sidebar.results.isEmpty {
                ContentUnavailableView {
                    Text(sidebar.query.isEmpty ? "Type to Search" : "No Results")
                }
                .frame(maxHeight: .infinity)
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
