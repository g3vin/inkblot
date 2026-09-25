import SwiftUI
import UniformTypeIdentifiers

/// The Notes tab: the active document's notes as a tree of replies.
///
/// Ordering is the page's `compareNotes`: pinned first, then anchored notes in document
/// order, then free notes, newest first. Every edit is a `NotePatch` — see
/// `bridge/sidebar.rs` for why never a whole note.
struct NotesPanelView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let sidebar = model.sidebar
        let branches = NoteTree.build(sidebar.notes) { note in
            sidebar.matchesFilter(note.anchor, note.content)
        }
        if branches.isEmpty {
            ContentUnavailableView {
                Text(sidebar.notes.isEmpty ? "No Notes Yet" : "No Matching Notes")
            } description: {
                Text(sidebar.notes.isEmpty ? "Select text in the document and choose Add Note." : "")
            }
            .frame(maxHeight: .infinity)
        } else {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    ForEach(branches) { branch in
                        NoteBranchView(branch: branch, depth: 0, filtering: !sidebar.query.isEmpty)
                    }
                }
                .padding(12)
            }
        }
    }
}

/// A note and its replies, pruned to what matches the filter.
struct NoteTree: Identifiable {
    let note: Note
    let children: [NoteTree]
    var id: String { note.id }

    static func build(_ notes: [Note], matches: (Note) -> Bool) -> [NoteTree] {
        let sorted = notes.sorted(by: NoteTree.ordered)
        let byParent = Dictionary(grouping: sorted) { $0.parentNoteId ?? "" }
        func branch(_ note: Note) -> NoteTree? {
            let children = (byParent[note.id] ?? []).compactMap(branch)
            guard matches(note) || !children.isEmpty else { return nil }
            return NoteTree(note: note, children: children)
        }
        return (byParent[""] ?? []).compactMap(branch)
    }

    /// `compareNotes` in `noteUtils.js`.
    static func ordered(_ a: Note, _ b: Note) -> Bool {
        if a.pinned != b.pinned { return a.pinned }
        let aFree = a.type == .free, bFree = b.type == .free
        if aFree != bFree { return !aFree }
        if !aFree {
            let aFrom = a.from ?? .greatestFiniteMagnitude
            let bFrom = b.from ?? .greatestFiniteMagnitude
            if aFrom != bFrom { return aFrom < bFrom }
        }
        return a.updatedAt > b.updatedAt
    }
}

private struct NoteBranchView: View {
    @Environment(AppModel.self) private var model
    let branch: NoteTree
    let depth: Int
    let filtering: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            NoteCardView(note: branch.note, hasChildren: !branch.children.isEmpty)
                .padding(.leading, CGFloat(depth) * 16)
                // Onto a canvas: the page reads this URL off an ordinary HTML5 drop
                // (`noteDragURL` in canvasEvents.js). A native drag cannot hit-test the
                // canvas the way the page's own pointer drag does, so it doesn't try.
                .onDrag {
                    guard let url = NoteDrag.url(docPath: model.sidebar.notesDocPath, noteId: branch.note.id) else {
                        return NSItemProvider()
                    }
                    return NSItemProvider(object: url as NSURL)
                }
            if !branch.note.collapsedChildren || filtering {
                ForEach(branch.children) { child in
                    NoteBranchView(branch: child, depth: depth + 1, filtering: filtering)
                }
            }
        }
    }
}

/// One note. Used by the Notes tab and by the glass hover card over the document.
struct NoteCardView: View {
    @Environment(AppModel.self) private var model
    let note: Note
    var hasChildren = false
    var glass = false

    @State private var draft = ""
    @FocusState private var editing: Bool
    @State private var commitTask: Task<Void, Never>?
    @State private var pickingImages = false

    static let colors = ["#ffd54f", "#ff9aa2", "#9ad0f5", "#9ee493", "#c7a8ff", "#ffb86b"]

    var body: some View {
        let sidebar = model.sidebar
        let accent = Color(hex: note.color) ?? .accentColor

        VStack(alignment: .leading, spacing: 8) {
            // A hover card has neither half of this row: it sits over its quote, which
            // the page highlights, and its actions are in its own top row
            // (`NotePreviewOverlay`). Only the Notes tab, away from the text, needs them here.
            if !glass {
                HStack(spacing: 6) {
                    if note.type == .quote {
                        Button { sidebar.jump(to: note) } label: {
                            Text("“\(note.anchor)”")
                                .font(.callout.italic())
                                .lineLimit(2)
                                .multilineTextAlignment(.leading)
                        }
                        .buttonStyle(.plain)
                        .help("Show in the document")
                    }
                    Spacer(minLength: 4)
                    NoteActions(note: note, hasChildren: hasChildren)
                }
            }

            TextField("Type your note here…", text: $draft, axis: .vertical)
                .textFieldStyle(.plain)
                // A hover card is only as tall as its text, editing or not: it grows a line
                // at a time as the text needs, and never jumps when clicked into.
                .lineLimit(glass ? 1...20 : editing ? 3...20 : 1...6)
                .focused($editing)
                .onChange(of: draft) { _, text in scheduleCommit(text) }
                .onChange(of: editing) { _, isEditing in if !isEditing { commit(draft) } }

            // On a hover card the attachments and the time sit on the card's bottom edge,
            // however tall it has been made.
            if glass { Spacer(minLength: 0) }

            if !note.images.isEmpty { images }
            if !note.audio.isEmpty { memos }

            HStack(spacing: 10) {
                if editing || glass { attachControls }
                Spacer()
                Text(note.timestamp).font(.caption2).foregroundStyle(.secondary)
            }
        }
        .padding(12)
        .background(alignment: .leading) {
            if !glass {
                RoundedRectangle(cornerRadius: 2).fill(accent).frame(width: 3).padding(.vertical, 8)
            }
        }
        .background {
            if !glass {
                RoundedRectangle(cornerRadius: 12).fill(.background.secondary)
            }
        }
        .onAppear { draft = note.content }
        .onChange(of: note.content) { _, content in
            // The page is the source of truth, but not while the user is typing here —
            // its echo of a half-committed draft would move the caret.
            if !editing { draft = content }
        }
        .dropDestination(for: URL.self) { urls, _ in attachImages(urls) }
    }

    private var images: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 6) {
                ForEach(note.images, id: \.id) { image in
                    if let picture = PlatformImage.fromDataURI(image.src) {
                        Image(platformImage: picture)
                            .resizable()
                            .scaledToFill()
                            .frame(width: 64, height: 64)
                            .clipShape(.rect(cornerRadius: 8))
                            .contextMenu {
                                Button("Remove Image", role: .destructive) {
                                    model.sidebar.updateNote(note, .with(
                                        images: note.images.filter { $0.id != image.id }))
                                }
                            }
                    }
                }
            }
        }
        .scrollIndicators(.never)
    }

    private var memos: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(note.audio, id: \.id) { clip in
                HStack(spacing: 6) {
                    Button {
                        if let root = model.sidebar.projectRoot { model.memoPlayer.toggle(clip, projectRoot: root) }
                    } label: {
                        Image(systemName: model.memoPlayer.playingClipId == clip.id ? "pause.fill" : "play.fill")
                    }
                    Text(formatMemoDuration(clip.durationMs)).font(.caption.monospacedDigit())
                    Spacer()
                    Button {
                        model.sidebar.updateNote(note, .with(audio: note.audio.filter { $0.id != clip.id }))
                    } label: { Image(systemName: "trash") }
                    .help("Delete voice memo")
                }
                .buttonStyle(.borderless)
            }
        }
    }

    private var attachControls: some View {
        let recorder = model.memoRecorder
        return HStack(spacing: 8) {
            Button {
                if recorder.isRecording(note.id) {
                    guard let root = model.sidebar.projectRoot,
                          let clip = recorder.stop(projectRoot: root) else { return }
                    model.sidebar.updateNote(note, .with(audio: note.audio + [clip]))
                } else {
                    Task { await recorder.start(for: note.id) }
                }
            } label: {
                if recorder.isRecording(note.id) {
                    Label(formatMemoDuration(recorder.elapsed * 1000), systemImage: "stop.circle.fill")
                        .foregroundStyle(.red)
                } else {
                    Image(systemName: "mic")
                }
            }
            .help(recorder.error ?? (recorder.isRecording(note.id) ? "Stop recording" : "Record a voice memo"))
            .disabled(recorder.recordingNoteId != nil && !recorder.isRecording(note.id))

            Button { pickImages() } label: { Image(systemName: "photo") }
                .help("Add image")
        }
        .buttonStyle(.borderless)
        .font(.caption)
    }

    /* ---------------- editing ---------------- */

    /// Commit a pause after the last keystroke, so the page — and the autosave behind it —
    /// sees a note being written without a message per character.
    private func scheduleCommit(_ text: String) {
        commitTask?.cancel()
        commitTask = Task {
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            commit(text)
        }
    }

    private func commit(_ text: String) {
        commitTask?.cancel()
        guard text != note.content else { return }
        model.sidebar.updateNote(note, .with(content: text))
    }

    /// `fileImporter` rather than `NSOpenPanel`: the same picker on a Mac, the Files
    /// sheet on an iPad or a phone.
    private func pickImages() {
        pickingImages = true
    }

    /// Note images are inlined as data URIs — the page's format, see `NoteImage`.
    @discardableResult
    private func attachImages(_ urls: [URL]) -> Bool {
        let added = urls.compactMap { url -> NoteImage? in
            // A picked file outside the app's container is lent, not given (iOS).
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            guard let type = UTType(filenameExtension: url.pathExtension), type.conforms(to: .image),
                  let mime = type.preferredMIMEType,
                  let data = try? Data(contentsOf: url) else { return nil }
            return NoteImage(id: UUID().uuidString.lowercased(),
                             src: "data:\(mime);base64,\(data.base64EncodedString())",
                             mimeType: mime)
        }
        guard !added.isEmpty else { return false }
        model.sidebar.updateNote(note, .with(images: note.images + added))
        return true
    }
}

extension NotePatch {
    /// A patch naming only what changed. The generated memberwise init requires every
    /// field; this is the one with defaults.
    static func with(content: String? = nil, color: String? = nil, pinned: Bool? = nil,
                     collapsedChildren: Bool? = nil, images: [NoteImage]? = nil,
                     audio: [AudioClip]? = nil, previewLayout: NotePreviewLayout? = nil,
                     previewSize: NotePreviewSize? = nil) -> NotePatch {
        NotePatch(content: content, color: color, pinned: pinned, collapsedChildren: collapsedChildren,
                  images: images, audio: audio, previewLayout: previewLayout, previewSize: previewSize)
    }
}

extension Color {
    /// `#rgb` / `#rrggbb`, as notes store their colour.
    init?(hex: String) {
        var value = hex.trimmingCharacters(in: .whitespaces)
        guard value.hasPrefix("#") else { return nil }
        value.removeFirst()
        if value.count == 3 { value = value.map { "\($0)\($0)" }.joined() }
        guard value.count == 6, let rgb = Int(value, radix: 16) else { return nil }
        self.init(red: Double((rgb >> 16) & 0xff) / 255,
                  green: Double((rgb >> 8) & 0xff) / 255,
                  blue: Double(rgb & 0xff) / 255)
    }
}

/// A note's own buttons — collapse, colour, pin, delete. The Notes tab puts them beside
/// the quote; a hover card, in its top row with its other buttons.
/// Folds a note's replies away, or brings them back.
struct NoteCollapseButton: View {
    @Environment(AppModel.self) private var model
    let note: Note
    /// As `NoteActions.docPath`.
    var docPath: String? = nil

    var body: some View {
        Button {
            let patch = NotePatch.with(collapsedChildren: !note.collapsedChildren)
            if let docPath {
                model.sidebar.updateNote(note, in: docPath, patch)
            } else {
                model.sidebar.updateNote(note, patch)
            }
        } label: {
            Image(systemName: note.collapsedChildren ? "chevron.right" : "chevron.down")
        }
        .help(note.collapsedChildren ? "Expand branch" : "Collapse branch")
    }
}

struct NoteActions: View {
    @Environment(AppModel.self) private var model
    let note: Note
    var hasChildren = false
    /// Which document the note is in, for a hover card — it may not be the one the Notes
    /// tab is showing. `nil` means the Notes tab's.
    var docPath: String? = nil
    /// The gap between the buttons; a hover card's header sets it to match its own.
    var spacing: CGFloat = 2
    /// A hover card puts the collapse chevron in its own corner instead.
    var showsCollapse = true

    @State private var confirmDelete = false

    var body: some View {
        let sidebar = model.sidebar
        HStack(spacing: spacing) {
            if hasChildren && showsCollapse {
                NoteCollapseButton(note: note, docPath: docPath)
            }
            Menu {
                ForEach(NoteCardView.colors, id: \.self) { hex in
                    Button { update(.with(color: hex)) } label: {
                        Label(hex, systemImage: note.color == hex ? "checkmark.circle.fill" : "circle.fill")
                    }
                    .tint(Color(hex: hex))
                }
            } label: {
                Circle().fill(Color(hex: note.color) ?? .accentColor).frame(width: 10, height: 10)
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .fixedSize()
            .help("Note color")
            Button {
                update(.with(pinned: !note.pinned))
            } label: {
                Image(systemName: note.pinned ? "pin.fill" : "pin")
            }
            .help(note.pinned ? "Unpin note" : "Pin note")
            Button { confirmDelete = true } label: { Image(systemName: "trash") }
                .help("Delete note")
        }
        .buttonStyle(.borderless)
        .font(.caption)
        .confirmationDialog("Delete note?", isPresented: $confirmDelete) {
            Button("Delete", role: .destructive) {
                if let docPath { sidebar.removeNote(note, in: docPath) } else { sidebar.removeNote(note) }
            }
        } message: {
            if hasChildren { Text("Its replies will be deleted too.") }
        }
    }

    private func update(_ patch: NotePatch) {
        if let docPath {
            model.sidebar.updateNote(note, in: docPath, patch)
        } else {
            model.sidebar.updateNote(note, patch)
        }
    }
}
