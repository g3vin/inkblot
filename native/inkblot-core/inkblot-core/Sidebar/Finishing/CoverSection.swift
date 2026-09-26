import AppKit
import SwiftUI

/// The Print & Export tab's Cover section: the book's cover versions, their pictures,
/// and what a printer would say about them.
///
/// The app does not design covers: the author brings a front, a back and a spine — or
/// one picture across the whole wrap — and this fits them to the book's trim and spine
/// and checks them. Each version is kept; the active one is what print, the cover PDF
/// and the EPUB use. The cover itself, drawn to scale with its guides, is in the Typeset
/// view (Show the Cover), where pictures are dropped straight onto it.
struct CoverSection: View {
    @Environment(AppModel.self) private var model
    @State private var renaming: CoverSetView?
    @State private var newName = ""
    @State private var pendingDelete: CoverSetView?

    var body: some View {
        let layout = model.pageLayout
        let cover = layout.state?.cover
        let active = cover?.sets.first { $0.id == cover?.active }
        FinishingSection("Cover", id: FinishingSectionID.cover) {
            if let cover, !cover.sets.isEmpty {
                ScrollView(.horizontal) {
                    HStack(spacing: 10) {
                        ForEach(cover.sets, id: \.id) { set in
                            Button {
                                layout.editCovers(.activate, id: set.id)
                            } label: {
                                VStack(spacing: 3) {
                                    thumbnail(set)
                                        .frame(width: 44, height: 64)
                                        .overlay {
                                            RoundedRectangle(cornerRadius: 2)
                                                .strokeBorder(set.id == cover.active ? Color.accentColor : .secondary.opacity(0.3), lineWidth: set.id == cover.active ? 2 : 0.5)
                                        }
                                    Text(set.name).font(.caption).lineLimit(1).frame(maxWidth: 64)
                                }
                            }
                            .buttonStyle(.plain)
                            .contextMenu {
                                Button("Rename…") { newName = set.name; renaming = set }
                                Button("Duplicate") { layout.editCovers(.duplicate, id: set.id) }
                                Button("Delete…", role: .destructive) { pendingDelete = set }
                            }
                            .help(set.id == cover.active ? "The cover in use" : "Use this version")
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
            HStack {
                Button("New Version") { layout.editCovers(.add) }
                if let active {
                    Button("Duplicate") { layout.editCovers(.duplicate, id: active.id) }
                    Button("Rename…") { newName = active.name; renaming = active }
                }
                Spacer()
            }
            .controlSize(.small)
            if let active {
                part("Front", .front, active.frontFile)
                part("Back", .back, active.backFile)
                part("Spine", .spine, active.spineFile)
                part("Whole Wrap", .wrap, active.wrapFile)
                Picker("Fit", selection: Binding(
                    get: { active.fit },
                    set: { layout.editCovers(.setFit, id: active.id, fit: $0) })) {
                    Text("Fill, Cropping").tag(CoverFit.fill)
                    Text("Fit Inside").tag(CoverFit.fit)
                    Text("Stretch").tag(CoverFit.stretch)
                }
            } else {
                Button("Choose a Front…") { choose(.front) }
            }
            if let cover {
                LabeledContent("Full Wrap") {
                    Text(String(format: "%.1f × %.1f mm", cover.wrapWidthMm, cover.wrapHeightMm)).monospacedDigit().foregroundStyle(.secondary)
                }
                LabeledContent("Spine") {
                    Text(cover.pageCount > 0 ? String(format: "%.1f mm · %d pages", cover.spineWidthMm, cover.pageCount) : "Count the pages")
                        .monospacedDigit().foregroundStyle(.secondary)
                }
                ForEach(cover.checks, id: \.id) { issue in
                    if issue.severity == .note {
                        FinishingNote(issue.message)
                    } else {
                        FinishingCaution(text: issue.message)
                    }
                }
            }
            HStack {
                Button("Show the Cover") { layout.showCover() }
                Spacer()
                Button("Export Cover PDF…") { layout.export(.coverPdf, scope: layout.scope == .document ? .folder : layout.scope) }
                    .disabled(active == nil)
            }
        } footer: {
            FinishingNote("One PDF of back, spine and front with ⅛″ bleed, as KDP and IngramSpark take it. The front is also the e-book’s cover.")
        }
        .alert("Rename Cover", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Name", text: $newName)
            Button("Rename") {
                if let set = renaming { layout.editCovers(.rename, id: set.id, name: newName) }
                renaming = nil
            }
            Button("Cancel", role: .cancel) { renaming = nil }
        }
        .confirmationDialog(pendingDelete.map { "Delete the cover “\($0.name)”?" } ?? "", isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }), titleVisibility: .visible, presenting: pendingDelete) { set in
            Button("Delete", role: .destructive) { layout.editCovers(.delete, id: set.id) }
        } message: { _ in
            Text("Its pictures stay in the project.")
        }
    }

    @ViewBuilder
    private func thumbnail(_ set: CoverSetView) -> some View {
        if let file = set.frontFile ?? set.wrapFile, let image = NSImage(contentsOfFile: file) {
            Image(nsImage: image).resizable().aspectRatio(contentMode: .fill).clipShape(.rect(cornerRadius: 2))
        } else {
            RoundedRectangle(cornerRadius: 2).fill(.quaternary).overlay { Image(systemName: "book.closed").foregroundStyle(.secondary) }
        }
    }

    private func part(_ title: String, _ part: CoverPart, _ file: String?) -> some View {
        LabeledContent(title) {
            HStack(spacing: 8) {
                if let file, let image = NSImage(contentsOfFile: file) {
                    Image(nsImage: image).resizable().aspectRatio(contentMode: .fit).frame(width: 32, height: 24)
                }
                Button(file == nil ? "Choose…" : "Change…") { choose(part) }
                if file != nil {
                    Button("Remove", role: .destructive) { model.pageLayout.setCoverImage(part, url: nil) }
                }
            }
        }
    }

    private func choose(_ part: CoverPart) {
        ChapterOpeningsSection.choosePicture(message: "Choose a picture for the cover’s \(part.rawValue)") {
            model.pageLayout.setCoverImage(part, url: $0)
        }
    }
}
