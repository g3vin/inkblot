import AppKit
import Observation
import SwiftUI

/// The projects the picker offers, newest first.
///
/// Read from the core rather than from the page: the picker is up before the page is,
/// and it is what decides which project the page opens. Recency comes from the page's
/// own session preference (`inkblot-session`, the same one its landing page sorted by),
/// which it stamps each time a project is opened.
@MainActor
@Observable
final class ProjectPicker {
    struct Project: Identifiable, Hashable {
        let name: String
        let root: String
        let lastOpened: Date?
        var id: String { name }

        /// Where it lives, as the Finder would say it: the folder that holds it.
        var location: String {
            ((root as NSString).deletingLastPathComponent as NSString).abbreviatingWithTildeInPath
        }
    }

    private(set) var projects: [Project] = []
    var selection: String?

    @ObservationIgnored private let core: CoreService

    init(core: CoreService) {
        self.core = core
    }

    func reload() {
        let opened = lastOpened()
        projects = core.core.listProjects()
            .map { Project(name: $0, root: core.core.projectRoot(projectName: $0), lastOpened: opened[$0]) }
            .sorted { left, right in
                switch (left.lastOpened, right.lastOpened) {
                case let (l?, r?) where l != r: l > r
                case (.some, nil): true
                case (nil, .some): false
                default: left.name.localizedStandardCompare(right.name) == .orderedAscending
                }
            }
        if selection.map({ name in !projects.contains { $0.name == name } }) ?? true {
            selection = projects.first?.name
        }
    }

    /// Adopt a folder that is already on disk. Returns the project's name.
    func link(_ folder: URL) throws -> String {
        let name = try core.core.linkProject(projectDir: folder.path)
        reload()
        return name
    }

    /// A new, empty project — in the app's own storage unless given a folder to hold it.
    func create(_ rawName: String, in parent: URL?) throws -> String {
        let name = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { throw Failure("Give the project a name.") }
        guard !name.hasPrefix("."), !name.contains("/") else { throw Failure("That name can’t be used for a project.") }
        guard !projects.contains(where: { $0.name.localizedCaseInsensitiveCompare(name) == .orderedSame }) else {
            throw Failure("A project with that name already exists.")
        }
        guard try core.core.createProject(projectName: name, targetParentDir: parent?.path) else {
            throw Failure("Could not create that project.")
        }
        reload()
        return name
    }

    struct Failure: LocalizedError {
        let errorDescription: String?
        init(_ message: String) { errorDescription = message }
    }

    /// `projects[name].updatedAt` from the page's session, which it writes as
    /// `Date.toISOString()` — always with milliseconds.
    private func lastOpened() -> [String: Date] {
        guard let raw = try? core.core.preferencesGet(scope: "app", key: "inkblot-session"),
              let session = try? JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any],
              let projects = session["projects"] as? [String: Any]
        else { return [:] }
        let format = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
        return projects.compactMapValues { entry in
            ((entry as? [String: Any])?["updatedAt"] as? String).flatMap { try? format.parse($0) }
        }
    }
}

/// The window Inkblot opens with: pick a project, and the editor opens on it.
///
/// Modelled on Xcode's welcome window — a small, tall, title-less window with a glass
/// close button, the app's icon and name, the actions under them, and the projects in
/// one centred list. Opening a project hands it to the page (`AppModel.openProject`),
/// opens the editor window and closes this one.
struct ProjectPickerView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openWindow) private var openWindow
    @Environment(\.dismissWindow) private var dismissWindow
    @State private var creating: NewProjectRequest?
    @State private var failure: String?
    @FocusState private var listFocused: Bool

    static let windowID = "picker"
    static let size = CGSize(width: 480, height: 630)

    private var picker: ProjectPicker { model.picker }

    var body: some View {
        VStack(spacing: 0) {
            header
            actions
                .padding(.top, 15)
            projectList
                .padding(.top, 16)
        }
        .padding(.horizontal, 60)
        .padding(.top, 76)
        .padding(.bottom, 60)
        .frame(width: Self.size.width)
        .frame(maxHeight: .infinity)
        .overlay(alignment: .topLeading) { closeButton.padding(20) }
        .background(Color(nsColor: .textBackgroundColor))
        // Laid out from the window's top edge, up under the hidden title bar, as Xcode's
        // is. The window's height is the scene's `defaultSize`, not this view's: a fixed
        // height here would have the title bar's safe area added on top of it.
        .ignoresSafeArea()
        .background(PickerWindowStyler())
        .onAppear {
            picker.reload()
            listFocused = true
        }
        .sheet(item: $creating) { request in
            NewProjectSheet(parent: request.parent) { name, parent in
                try picker.create(name, in: parent)
            } onCreated: { name in
                creating = nil
                open(name)
            }
        }
        .alert("Couldn’t Open the Project", isPresented: Binding(
            get: { failure != nil }, set: { if !$0 { failure = nil } })
        ) {
            Button("OK") { failure = nil }
        } message: {
            Text(failure ?? "")
        }
    }

    /* ---------------- parts ---------------- */

    private var closeButton: some View {
        Button {
            dismissWindow(id: Self.windowID)
        } label: {
            Image(systemName: "xmark")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(.primary)
                .frame(width: 36, height: 36)
                .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: .circle)
        .keyboardShortcut(.cancelAction)
        .help("Close")
    }

    private var header: some View {
        VStack(spacing: 0) {
            Image("InkblotLogo")
                .resizable()
                .interpolation(.high)
                .aspectRatio(contentMode: .fill)
                .frame(width: 98, height: 98)
                .clipShape(.rect(cornerRadius: 22, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .strokeBorder(.black.opacity(0.08), lineWidth: 0.5)
                }
                .shadow(color: .black.opacity(0.18), radius: 6, y: 3)
            Text("Inkblot")
                .font(.system(size: 20, weight: .bold))
                .padding(.top, 12)
            Text("Version \(Self.version)")
                .font(.system(size: 14))
                .foregroundStyle(.secondary)
        }
    }

    private var actions: some View {
        HStack(spacing: 8) {
            Button("Open…", action: chooseExisting)
                .buttonStyle(PickerCapsuleButtonStyle())
            // The chevron is a menu of its own over the button's trailing end, as in
            // Xcode: the button makes a project, the chevron asks where.
            Button("New Project") { creating = NewProjectRequest(parent: nil) }
                .buttonStyle(PickerCapsuleButtonStyle(trailingPadding: 34))
                .overlay(alignment: .trailing) {
                Menu {
                    Button("New Project…") { creating = NewProjectRequest(parent: nil) }
                    Button("New Project in Folder…", action: chooseNewProjectFolder)
                } label: {
                    Image(systemName: "chevron.down")
                        .font(.system(size: 12, weight: .semibold))
                        .frame(width: 28, height: 28)
                        .contentShape(.rect)
                }
                .accessibilityLabel("New Project Options")
                .menuStyle(.button)
                .buttonStyle(.plain)
                .menuIndicator(.hidden)
                .fixedSize()
                .padding(.trailing, 5)
            }
        }
    }

    private var projectList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(picker.projects) { project in
                        ProjectRow(project: project, isSelected: picker.selection == project.id)
                            .id(project.id)
                            .onTapGesture(count: 2) { open(project.name) }
                            .simultaneousGesture(TapGesture().onEnded {
                                picker.selection = project.id
                                listFocused = true
                            })
                            .contextMenu {
                                Button("Open") { open(project.name) }
                                Button("Show in Finder") {
                                    NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: project.root)])
                                }
                            }
                    }
                }
                .padding(8)
            }
            .scrollIndicators(.automatic)
            .overlay {
                if picker.projects.isEmpty {
                    Text("No Projects")
                        .font(.system(size: 15))
                        .foregroundStyle(.tertiary)
                }
            }
            .focusable()
            .focused($listFocused)
            .focusEffectDisabled()
            .onKeyPress(.upArrow) { moveSelection(by: -1, proxy); return .handled }
            .onKeyPress(.downArrow) { moveSelection(by: 1, proxy); return .handled }
            .onKeyPress(.return) {
                guard let selection = picker.selection else { return .ignored }
                open(selection)
                return .handled
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.primary.opacity(0.03), in: .rect(cornerRadius: 12, style: .continuous))
    }

    /* ---------------- actions ---------------- */

    private func open(_ name: String) {
        model.openProject(name)
        openWindow(id: "main")
        dismissWindow(id: Self.windowID)
    }

    private func moveSelection(by step: Int, _ proxy: ScrollViewProxy) {
        let names = picker.projects.map(\.name)
        guard !names.isEmpty else { return }
        let current = picker.selection.flatMap { names.firstIndex(of: $0) } ?? (step > 0 ? -1 : names.count)
        let next = names[min(max(current + step, 0), names.count - 1)]
        picker.selection = next
        proxy.scrollTo(next)
    }

    /// "Open…": a folder already on disk becomes a project under its own name.
    private func chooseExisting() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "Open"
        panel.message = "Choose a project folder"
        guard panel.runModal() == .OK, let folder = panel.url else { return }
        do {
            open(try picker.link(folder))
        } catch {
            failure = error.localizedDescription
        }
    }

    private func chooseNewProjectFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false
        panel.prompt = "Choose"
        panel.message = "Choose the folder to create the project in"
        guard panel.runModal() == .OK, let folder = panel.url else { return }
        creating = NewProjectRequest(parent: folder)
    }

    private static var version: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"
    }
}

private struct NewProjectRequest: Identifiable {
    let id = UUID()
    let parent: URL?
}

/// One project: its folder's icon, its name, and where it lives.
private struct ProjectRow: View {
    let project: ProjectPicker.Project
    let isSelected: Bool

    var body: some View {
        HStack(spacing: 14) {
            Image(nsImage: NSWorkspace.shared.icon(forFile: project.root))
                .resizable()
                .frame(width: 32, height: 32)
            VStack(alignment: .leading, spacing: 1) {
                Text(project.name)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(isSelected ? .white : .primary)
                Text(project.location)
                    .font(.system(size: 11.5))
                    .foregroundStyle(isSelected ? AnyShapeStyle(.white.opacity(0.85)) : AnyShapeStyle(.secondary))
            }
            .lineLimit(1)
            .truncationMode(.middle)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .frame(height: 46)
        .background {
            if isSelected {
                RoundedRectangle(cornerRadius: 7, style: .continuous).fill(Color.accentColor)
            }
        }
        .contentShape(.rect)
        .help(project.root)
    }
}

/// The grey capsule Xcode's welcome window uses for its actions.
private struct PickerCapsuleButtonStyle: ButtonStyle {
    var trailingPadding: CGFloat = 16
    @State private var hovering = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 14))
            .foregroundStyle(.primary)
            .lineLimit(1)
            .padding(.leading, 16)
            .padding(.trailing, trailingPadding)
            .frame(maxWidth: .infinity, minHeight: 36)
            .background(
                Color.primary.opacity(configuration.isPressed ? 0.16 : hovering ? 0.11 : 0.08),
                in: .capsule)
            .contentShape(.capsule)
            .onHover { hovering = $0 }
    }
}

/// Name a new project, and optionally say where it goes.
private struct NewProjectSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var parent: URL?
    @State private var failure: String?

    let create: (String, URL?) throws -> String
    let onCreated: (String) -> Void

    init(parent: URL?, create: @escaping (String, URL?) throws -> String, onCreated: @escaping (String) -> Void) {
        _parent = State(initialValue: parent)
        self.create = create
        self.onCreated = onCreated
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("New Project")
                .font(.headline)
            TextField("Project name", text: $name)
                .textFieldStyle(.roundedBorder)
                .onSubmit(submit)
                .onChange(of: name) { failure = nil }
            HStack(spacing: 6) {
                Image(systemName: "folder")
                    .foregroundStyle(.secondary)
                Text(parent.map { ($0.path as NSString).abbreviatingWithTildeInPath } ?? "Default location")
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .foregroundStyle(.secondary)
                Spacer()
                Button("Change…", action: chooseFolder)
                    .controlSize(.small)
            }
            .font(.callout)
            if let failure {
                Text(failure)
                    .font(.callout)
                    .foregroundStyle(.red)
            }
            HStack {
                Spacer()
                Button("Cancel", role: .cancel) { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("Create", action: submit)
                    .keyboardShortcut(.defaultAction)
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(20)
        .frame(width: 340)
    }

    private func submit() {
        do {
            onCreated(try create(name, parent))
        } catch {
            failure = error.localizedDescription
        }
    }

    private func chooseFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.prompt = "Choose"
        guard panel.runModal() == .OK else { return }
        parent = panel.url
    }
}

/// The picker's window has no title bar and no traffic lights — its glass close button
/// stands in for them — is moved by dragging anywhere that is not a control, and keeps
/// the size it opened at.
private struct PickerWindowStyler: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView { StylingView() }
    func updateNSView(_ view: NSView, context: Context) {}

    private final class StylingView: NSView {
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            guard let window else { return }
            for button in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton] {
                window.standardWindowButton(button)?.isHidden = true
            }
            window.styleMask.remove(.resizable)
            window.isMovableByWindowBackground = true
            window.titlebarAppearsTransparent = true
            window.titleVisibility = .hidden
        }
    }
}
