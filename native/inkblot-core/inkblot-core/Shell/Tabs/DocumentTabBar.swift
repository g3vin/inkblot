#if os(macOS)
import SwiftUI
import UniformTypeIdentifiers

/// The open documents, as tabs over the page column — Xcode's editor tabs, not macOS
/// window tabs. AppKit draws a window's tab bar across the whole window, inspector and
/// all, and each of its tabs is a window of its own; Xcode draws its editor tabs itself,
/// inside the editor, and so does this.
///
/// One capsule of Liquid Glass, the selected tab lit, as in Xcode 26. Each tab is as
/// wide as its name and the capsule as wide as its tabs, centred over the column; when they no longer fit the
/// column the row scrolls, the tabs keeping their widths — one layout either way, so a
/// few points more or less of column never changes how the tabs look. It sits in the detail column's `safeAreaBar`, so the page is told
/// it covers the top (`setPanelInsets`) and a document's text starts below it.
///
/// It is the inspector's selector bar's size and at its height (`InspectorView`): a
/// 24-point capsule beside a 28-point round button, so the two read as one row.
///
/// Click a tab to show it; the ✕ that appears on hover closes it. Drag a tab to
/// reorder, or a document from the file tree onto the bar to open it in a tab. A tab
/// holding a split names both its documents, each with its kind's symbol, the left (or
/// upper) one first — "jj | test"; the panes themselves carry no names.
///
/// Only while there is more than one document to tell apart (`needsTabBar`).
struct DocumentTabBar: View {
    @Environment(AppModel.self) private var model

    /// The tabs' own width, each as wide as its name.
    @State private var content: CGFloat = 0
    /// The width the capsule was given, to keep the selected tab in sight as it changes.
    @State private var shown: CGFloat = 0

    var body: some View {
        let tabs = model.tabs
        HStack(spacing: 8) {
            // Centred while the tabs leave room, the + with them.
            Spacer(minLength: 0)

            ScrollViewReader { proxy in
                ScrollView(.horizontal) {
                    row(tabs)
                        .fixedSize()
                        .onGeometryChange(for: CGFloat.self, of: \.size.width) { content = $0 }
                }
                .scrollIndicators(.never)
                .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
                // As wide as the tabs, or what the bar has; past that, it scrolls. A
                // most and never a least: a width the bar insisted on would be the
                // editor column's minimum, and the split view loops on one that moves.
                .frame(minWidth: 0, maxWidth: content)
                .onGeometryChange(for: CGFloat.self, of: \.size.width) { shown = $0 }
                // The selected tab stays in sight, when it changes and when the
                // column narrows under it.
                .onChange(of: tabs.activeTabId, initial: true) { _, id in
                    guard let id else { return }
                    withAnimation(.smooth(duration: 0.2)) { proxy.scrollTo(id) }
                }
                .onChange(of: shown) {
                    if let id = tabs.activeTabId { proxy.scrollTo(id) }
                }
            }
            .frame(height: 20)
            .padding(2)
            .glassEffect(.regular, in: .capsule)
            // Served before the spacers, which share what the tabs leave.
            .layoutPriority(1)
            // A tab or a document dropped past the last tab goes to the end.
            .onDrop(of: TabDrop.types, isTargeted: nil) { providers in
                TabDrop.accept(providers, onto: nil, tabs: tabs, files: model.tree.filePaths)
            }

            Button {
                tabs.newTab()
            } label: {
                Label("New Tab", systemImage: "plus")
                    .labelStyle(.iconOnly)
                    .frame(width: 28, height: 28)
                    .contentShape(.circle)
            }
            .buttonStyle(.plain)
            .glassEffect(.regular.interactive(), in: .circle)
            .help("Open a new tab (⌘T)")

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.top, 8)
        .padding(.bottom, 8)
        .background { TabShortcuts(tabs: tabs) }
        .animation(.smooth(duration: 0.2), value: tabs.tabs.map(\.id))
    }

    private func row(_ tabs: TabsModel) -> some View {
        HStack(spacing: 2) {
            ForEach(tabs.tabs, id: \.id) { tab in
                DocumentTabItem(tab: tab, title: title(of: tab, among: tabs.tabs))
                    // As wide as its name, within reason; a split tab holds two.
                    .frame(minWidth: 96, maxWidth: tab.secondaryName == nil ? 220 : 360)
                    .id(tab.id)
            }
        }
    }

    /// A tab's name, with its folder when another tab has the same name.
    private func title(of tab: DocTab, among all: [DocTab]) -> String {
        let clash = all.contains { $0.id != tab.id && $0.docPath != nil && $0.name == tab.name }
        guard clash, let folder = tab.folder else { return tab.name }
        return "\(tab.name) — \(folder)"
    }
}

/// What the bar takes from a drag: one of its own tabs, to move, or a document from the
/// file tree (`ProjectOutline`), to open in a tab. Both are private pasteboard types,
/// never plain text — a tab dragged over the page must not type its id into the
/// document.
@MainActor
enum TabDrop {
    static let tab = UTType(importedAs: "com.inkblot.tab")
    /// `NSPasteboard.PasteboardType.inkblotTreePath`, as a type.
    static let treePath = UTType(importedAs: "com.inkblot.tree-path")
    static let types = [tab, treePath]

    static func provider(for tab: DocTab) -> NSItemProvider {
        let provider = NSItemProvider()
        let id = Data(tab.id.utf8)
        provider.registerDataRepresentation(for: Self.tab, visibility: .ownProcess) { done in
            done(id, nil)
            return nil
        }
        return provider
    }

    /// Put dropped tabs where `target` is (the end, with none), and open dropped
    /// documents in tabs.
    static func accept(_ providers: [NSItemProvider], onto target: DocTab?, tabs: TabsModel, files: Set<String>) -> Bool {
        let targetId = target?.id
        var accepted = false
        for provider in providers {
            guard let type = types.first(where: { provider.hasItemConformingToTypeIdentifier($0.identifier) }) else { continue }
            accepted = true
            let isTab = type == Self.tab
            _ = provider.loadDataRepresentation(for: type) { data, _ in
                guard let data, let value = String(data: data, encoding: .utf8) else { return }
                Task { @MainActor in
                    if isTab {
                        if let target = tabs.tabs.first(where: { $0.id == targetId }) {
                            tabs.move(value, to: target)
                        } else {
                            tabs.moveToEnd(value)
                        }
                    } else if files.contains(value) {
                        tabs.openInTab(value)
                    }
                }
            }
        }
        return accepted
    }
}

/// One tab.
private struct DocumentTabItem: View {
    @Environment(AppModel.self) private var model
    let tab: DocTab
    let title: String
    @State private var hovering = false

    var body: some View {
        let tabs = model.tabs
        let selected = tab.id == tabs.activeTabId

        HStack(spacing: 6) {
            Image(systemName: tab.symbol)
                .foregroundStyle(selected ? .primary : .secondary)
            Text(title)
                .lineLimit(1)
                .truncationMode(.middle)
            if let second = tab.secondaryName, let symbol = tab.secondarySymbol {
                Text("|")
                    .foregroundStyle(.tertiary)
                Image(systemName: symbol)
                    .foregroundStyle(selected ? .primary : .secondary)
                Text(second)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }
        .font(.system(size: 12, weight: selected ? .medium : .regular))
        .imageScale(.small)
        .foregroundStyle(selected ? .primary : .secondary)
        .padding(.horizontal, 24)
        .frame(height: 20)
        // The close button on hover, at the leading edge, where Xcode puts it.
        .overlay(alignment: .leading) {
            Button {
                tabs.close(tab)
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 8, weight: .bold))
                    .frame(width: 16, height: 16)
                    .background(.quaternary, in: .circle)
                    .contentShape(.circle)
            }
            .buttonStyle(.plain)
            .padding(.leading, 3)
            .opacity(hovering ? 1 : 0)
            .help("Close Tab")
        }
        .background {
            Capsule()
                .fill(.primary.opacity(selected ? 0.14 : hovering ? 0.06 : 0))
        }
        .contentShape(.capsule)
        .onHover { hovering = $0 }
        .onTapGesture { tabs.select(tab) }
        .onDrag {
            TabDrop.provider(for: tab)
        } preview: {
            Label(title, systemImage: tab.symbol)
                .padding(8)
                .glassEffect(.regular, in: .capsule)
        }
        .onDrop(of: TabDrop.types, isTargeted: nil) { providers in
            TabDrop.accept(providers, onto: tab, tabs: tabs, files: model.tree.filePaths)
        }
        .contextMenu { menu }
        .help(tab.docPath ?? "A new tab")
        // One element, named for the tab; the close button is its Close action.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityTitle)
        .accessibilityValue(selected ? "Selected" : "")
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
        .accessibilityAction { tabs.select(tab) }
        .accessibilityAction(named: "Close") { tabs.close(tab) }
    }

    private var accessibilityTitle: String {
        guard let split = tab.split, let second = tab.secondaryName else { return title }
        return split == .rows ? "\(title) above \(second)" : "\(title) beside \(second)"
    }

    @ViewBuilder
    private var menu: some View {
        let tabs = model.tabs
        Button("Open in Split Right", systemImage: "rectangle.split.2x1") {
            tabs.openSplit(.columns, docPath: tab.docPath)
        }
        .disabled(!tabs.canOpenInSplit(tab))
        Button("Open in Split Below", systemImage: "rectangle.split.1x2") {
            tabs.openSplit(.rows, docPath: tab.docPath)
        }
        .disabled(!tabs.canOpenInSplit(tab))
        Button("Move to New Window", systemImage: "macwindow.badge.plus") { tabs.moveToNewWindow(tab) }
            .disabled(tab.docPath == nil)
        Divider()
        Button("Close Tab") { tabs.close(tab) }
        Button("Close Other Tabs") { tabs.closeOthers(tab) }
            .disabled(tabs.tabs.count < 2)
        Button("Close Tabs to the Right") { tabs.closeToTheRight(tab) }
            .disabled(tabs.tabs.last?.id == tab.id)
    }
}

/// ⌘1 to ⌘9, as in Safari. Buttons nobody sees, because a menu item for each would
/// be nine items in the Window menu that nobody reads; the menu has ⌃Tab and ⌃⇧Tab.
private struct TabShortcuts: View {
    let tabs: TabsModel

    var body: some View {
        ZStack {
            ForEach(1...9, id: \.self) { number in
                Button("Show Tab \(number)") { tabs.select(number: number) }
                    .keyboardShortcut(KeyEquivalent(Character(String(number))), modifiers: .command)
            }
        }
        .opacity(0)
        .frame(width: 0, height: 0)
        .accessibilityHidden(true)
    }
}
#endif
