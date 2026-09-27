//! What these tests are for.
//!
//! The generated TypeScript and Swift are checked by `npm run types:check`, which
//! proves the three languages describe the same *types*. It does not look at a single
//! byte of JSON. But JSON is what actually crosses the seam, and a Swift shell will be
//! written against the exact shape below — so the shape is asserted literally here,
//! not derived from the same serde attributes it is meant to be checking.
//!
//! The exhaustive tag tests are the load-bearing ones. Adding a variant without
//! deciding what it looks like on the wire fails them, which is the only moment that
//! decision is cheap to make.

use super::*;
use crate::types::note::Note;
use serde_json::{json, Value};

fn page_setup() -> crate::types::PageSetup {
    use crate::types::{PageMargins, PageNumberFormat, PageOrientation, PageSetup, RunningText};
    let blank = RunningText { left: String::new(), center: String::new(), right: String::new() };
    PageSetup {
        preset_id: "trade-6x9".into(),
        width_mm: 152.4,
        height_mm: 228.6,
        orientation: PageOrientation::Portrait,
        margins: PageMargins { top_mm: 19.05, bottom_mm: 19.05, inside_mm: 15.875, outside_mm: 15.875, gutter_mm: 3.175 },
        mirror_margins: true,
        columns: 1,
        column_gap_mm: 6.35,
        header: RunningText { left: String::new(), center: "{chapter}".into(), right: String::new() },
        footer: RunningText { left: String::new(), center: "{page}".into(), right: String::new() },
        verso_header: Some(RunningText { center: "{title}".into(), ..blank.clone() }),
        verso_footer: None,
        header_distance_mm: 9.525,
        footer_distance_mm: 9.525,
        different_first_page: true,
        page_number_start: 1,
        page_number_format: PageNumberFormat::Arabic,
        widow_orphan_lines: 2,
        chapter_starts_on_recto: true,
        format_id: Some("trade-6x9".into()),
        typography: None,
        title_page: None,
    }
}

fn typography() -> crate::types::PrintTypography {
    use crate::types::{ChapterOpening, LineSpacing, PrintAlignment, PrintTypography};
    PrintTypography {
        font_family: "Georgia, serif".into(),
        font_size_pt: 11.0,
        line_spacing: LineSpacing::Multiple,
        line_value: 1.2,
        first_line_indent_mm: 7.62,
        paragraph_spacing_pt: 0.0,
        alignment: PrintAlignment::Justify,
        hyphenate: true,
        scene_break: "* * *".into(),
        chapter_opening: ChapterOpening::DropCap,
        chapter_sink_mm: 25.4,
        no_indent_after_break: true,
        images: Some(crate::types::ImageTypesetting::default()),
    }
}

fn book() -> crate::types::BookSettings {
    use crate::types::{BindingSettings, BindingType, BookSettings, DuplexMode, SheetFit};
    BookSettings {
        folder: "Manuscript".into(),
        title: "The Book".into(),
        author: "A. Writer".into(),
        language: "en-US".into(),
        cover_image: None,
        page_setup: Some(page_setup()),
        binding: BindingSettings {
            binding: BindingType::Signatures,
            sheets_per_signature: 4,
            sheet_preset_id: "letter".into(),
            sheet_fit: SheetFit::ActualSize,
            duplex: DuplexMode::Automatic,
            paper_thickness_mm: 0.1,
            crop_marks: true,
            include_guide: true,
        },
        excluded: vec!["Manuscript/notes".into()],
        chapter_numbering: crate::types::ChapterNumbering {
            style: crate::types::ChapterNumberStyle::Words,
            prefix: "Chapter".into(),
            include_title: true,
            start_at: 0,
            show_in_tree: true,
        },
        front_matter: crate::types::FrontMatter { half_title: true, dedication: "For M.".into(), contents: true, ..Default::default() },
        back_matter: crate::types::BackMatter { about_the_author: "A. Writer lives by the sea.".into(), ..Default::default() },
        publishing: crate::types::PublishingTarget { service: crate::types::PublishingService::Kdp, paper: crate::types::PaperStock::Cream },
        chapter_design: Some(crate::types::ChapterDesign {
            show_number: true,
            ornament: crate::types::OrnamentKind::Glyph,
            ornament_glyph: "❦".into(),
            chapter_break: crate::types::ChapterBreak::NewRightPage,
            style_id: Some("classic".into()),
            ..Default::default()
        }),
        part_design: None,
        items: vec![
            crate::types::BookItem {
                id: "d1".into(),
                kind: crate::types::BookItemKind::Matter,
                path: Some("Manuscript/.book/dedication-d1".into()),
                title: None,
                hidden: false,
                matter: Some(crate::types::MatterKind::Dedication),
                generated: None,
                chapter_type: None,
                page: Some(crate::types::PageOptions { position: crate::types::PagePosition::Sunk, ..Default::default() }),
            },
            crate::types::BookItem {
                id: "c1".into(),
                kind: crate::types::BookItemKind::Chapter,
                path: Some("Manuscript/One".into()),
                title: None,
                hidden: true,
                matter: None,
                generated: None,
                chapter_type: Some(crate::types::ChapterType::Prologue),
                page: None,
            },
        ],
        continuous: true,
        covers: vec![crate::types::CoverSet {
            id: "v1".into(),
            name: "Cover".into(),
            front: Some(".assets/covers/front.jpg".into()),
            back: None,
            spine: None,
            wrap: None,
            fit: crate::types::CoverFit::Fill,
            made_for_spine_mm: Some(12.4),
        }],
        active_cover: Some("v1".into()),
        digital: crate::types::DigitalOptions { drop_caps: false, ..Default::default() },
    }
}

fn anchor() -> TextAnchor {
    TextAnchor::new(4, 17, "she hesitated")
}

/// Round-trip through JSON and back, the way both halves will.
fn round_trip<T>(value: &T) -> T
where
    T: serde::Serialize + serde::de::DeserializeOwned + PartialEq + std::fmt::Debug,
{
    let text = serde_json::to_string(value).expect("serialize");
    let back: T = serde_json::from_str(&text).expect("deserialize");
    assert_eq!(value, &back, "value did not survive a JSON round trip");
    back
}

/// The `type` tag of an adjacently-tagged value, as it appears on the wire.
fn tag_of<T: serde::Serialize>(value: &T) -> String {
    let wire = serde_json::to_value(value).expect("serialize");
    wire["type"].as_str().expect("a string `type` tag").to_string()
}

/* ---------------- the literal wire shape ---------------- */

#[test]
fn a_command_is_type_and_payload_in_camel_case() {
    let command = NativeCommand::SetHighlight(SetHighlightCommand {
        target: EditorTarget::Primary,
        color: "#ffff00".into(),
        remember: true,
    });

    assert_eq!(
        serde_json::to_value(&command).unwrap(),
        json!({
            "type": "setHighlight",
            "payload": { "target": "primary", "color": "#ffff00", "remember": true }
        })
    );
}

#[test]
fn an_event_is_type_and_payload_in_camel_case() {
    let event = WebviewEvent::ActiveEditorChanged(ActiveEditorChanged {
        target: Some(EditorTarget::CanvasCard),
        doc_path: Some("chapters/one.canvas".into()),
        surface_id: Some("surface-2".into()),
    });

    assert_eq!(
        serde_json::to_value(&event).unwrap(),
        json!({
            "type": "activeEditorChanged",
            "payload": {
                "target": "canvasCard",
                "docPath": "chapters/one.canvas",
                "surfaceId": "surface-2"
            }
        })
    );
}

/// A field that is `None` is absent, not `null`. The TypeScript side reads these as
/// `field?: T`, and `"surfaceId": null` would be a present key holding nothing —
/// which `if (payload.surfaceId)` treats the same way but `'surfaceId' in payload`
/// does not.
#[test]
fn absent_optionals_are_omitted_rather_than_null() {
    let event = WebviewEvent::ActiveEditorChanged(ActiveEditorChanged {
        target: None,
        doc_path: None,
        surface_id: None,
    });

    assert_eq!(
        serde_json::to_value(&event).unwrap(),
        json!({ "type": "activeEditorChanged", "payload": {} })
    );
}

#[test]
fn an_envelope_wraps_without_flattening() {
    let inbound = InboundMessage::Command(CommandEnvelope {
        seq: 7,
        command: NativeCommand::InsertConversationTile(TargetOnly {
            target: EditorTarget::Secondary,
        }),
    });

    assert_eq!(
        serde_json::to_value(&inbound).unwrap(),
        json!({
            "kind": "command",
            "message": {
                "seq": 7,
                "command": {
                    "type": "insertConversationTile",
                    "payload": { "target": "secondary" }
                }
            }
        })
    );
}

/* ---------------- every variant, named once ---------------- */

/// One of each command, so that adding a variant means deciding its wire name here.
fn every_command() -> Vec<NativeCommand> {
    vec![
        NativeCommand::ApplyMark(ApplyMarkCommand {
            target: EditorTarget::Primary,
            mark: MarkKind::Bold,
        }),
        NativeCommand::SetColor(SetColorCommand {
            target: EditorTarget::Primary,
            color: "#112233".into(),
        }),
        NativeCommand::SetHighlight(SetHighlightCommand {
            target: EditorTarget::Primary,
            color: "#ffff00".into(),
            remember: false,
        }),
        NativeCommand::SetFontFamily(SetFontFamilyCommand {
            target: EditorTarget::Primary,
            family: "Georgia".into(),
        }),
        NativeCommand::SetFontSize(SetFontSizeCommand {
            target: EditorTarget::Primary,
            size: "18px".into(),
        }),
        NativeCommand::SetAlignment(SetAlignmentCommand {
            target: EditorTarget::Primary,
            alignment: Alignment::Center,
        }),
        NativeCommand::InsertTable(InsertTableCommand {
            target: EditorTarget::Primary,
            rows: 3,
            cols: 3,
            with_header_row: true,
        }),
        NativeCommand::InsertConversationTile(TargetOnly {
            target: EditorTarget::Primary,
        }),
        NativeCommand::OpenDocument(OpenDocumentCommand {
            path: "chapters/one.md".into(),
            pane: Pane::Secondary,
        }),
        NativeCommand::SetSelection(SetSelectionCommand {
            target: EditorTarget::Primary,
            anchor: anchor(),
            scroll_into_view: true,
            focus: true,
        }),
        NativeCommand::JumpToAnchor(JumpToAnchorCommand {
            target: EditorTarget::Primary,
            anchor: anchor(),
            prefer_positions: true,
        }),
        NativeCommand::SetContent(SetContentCommand {
            pane: Pane::Primary,
            doc_path: "chapters/one.md".into(),
            content: json!({ "type": "doc", "content": [] }),
            is_load: true,
        }),
        NativeCommand::ReplaceRanges(ReplaceRangesCommand {
            target: EditorTarget::Primary,
            edits: vec![RangeEdit { anchor: anchor(), text: "she paused".into() }],
        }),
        NativeCommand::SetCaretAtDocPos(SetCaretAtDocPosCommand {
            target: EditorTarget::Primary,
            pos: 42,
        }),
        NativeCommand::DictationPartial(DictationTranscript {
            text: "the quick brown".into(),
            session_id: Some("s1".into()),
        }),
        NativeCommand::DictationFinal(DictationTranscript {
            text: "the quick brown fox".into(),
            session_id: Some("s1".into()),
        }),
        NativeCommand::DictationLevel(DictationLevelCommand { level: 0.4 }),
        NativeCommand::DictationCancel(DictationCancelCommand { delete_text: true }),
        NativeCommand::SyncNotes(SyncNotesCommand {
            doc_path: "chapters/one.md".into(),
            notes: Vec::<Note>::new(),
        }),
        NativeCommand::CanvasCommand(CanvasCommandRequest {
            surface_id: "surface-1".into(),
            command: "zoom-to-fit".into(),
            detail: None,
        }),
        NativeCommand::MapCommand(MapCommandRequest {
            surface_id: "map-surface-0".into(),
            command: "panel-field".into(),
            detail: Some(json!({ "id": "pin.name", "value": "Harrowgate" })),
        }),
        NativeCommand::CanvasDropDoc(CanvasDropDocCommand {
            surface_id: "surface-1".into(),
            path: "chapters/one.md".into(),
            client_x: 10.0,
            client_y: 20.0,
        }),
        NativeCommand::CanvasDropNote(CanvasDropNoteCommand {
            surface_id: "surface-1".into(),
            doc_path: "chapters/one.md".into(),
            note_id: "n1".into(),
            client_x: 10.0,
            client_y: 20.0,
        }),
        NativeCommand::CanvasReveal(CanvasRevealCommand {
            doc_path: "board.canvas".into(),
            node_id: "node-1".into(),
        }),
        NativeCommand::CanvasRestore(CanvasRestoreCommand {
            doc_path: "board.canvas".into(),
            canvas: json!({ "nodes": [], "edges": [] }),
        }),
        NativeCommand::InsertPlainText(InsertPlainTextCommand {
            target: EditorTarget::Primary,
            text: "pasted".into(),
        }),
        NativeCommand::CreateEntry(CreateEntryCommand {
            parent_folder: "Part One".into(),
            name: "Board".into(),
            kind: EntryKind::Canvas,
        }),
        NativeCommand::RenameEntry(RenameEntryCommand {
            path: "Part One/Chapter 1".into(),
            is_folder: false,
            new_name: "Opening".into(),
        }),
        NativeCommand::MoveEntry(MoveEntryCommand {
            path: "Part One".into(),
            is_folder: true,
            target_folder: "".into(),
        }),
        NativeCommand::DeleteEntry(DeleteEntryCommand {
            path: "Part One/Chapter 1".into(),
            is_folder: false,
        }),
        NativeCommand::DuplicateEntry(DuplicateEntryCommand { path: "Part One/Chapter 1".into() }),
        NativeCommand::UpdateNote(UpdateNoteCommand {
            doc_path: "one".into(),
            note_id: "n1".into(),
            patch: NotePatch { pinned: Some(true), ..Default::default() },
        }),
        NativeCommand::RemoveNote(NoteRef { doc_path: "one".into(), note_id: "n1".into() }),
        NativeCommand::JumpToNote(NoteRef { doc_path: "one".into(), note_id: "n1".into() }),
        NativeCommand::HighlightNote(HighlightNoteCommand { note_id: Some("n1".into()) }),
        NativeCommand::ClipboardDrop(ClipboardDropCommand { text: "moved".into() }),
        NativeCommand::RemoveClipboardEntries(RemoveClipboardEntriesCommand { ids: None }),
        NativeCommand::InsertClipboardEntry(InsertClipboardEntryCommand {
            id: "c1".into(),
            target: EditorTarget::Primary,
        }),
        NativeCommand::RemoveTiles(RemoveTilesCommand { ids: Some(vec!["t1".into()]) }),
        NativeCommand::ReplaceTileWord(ReplaceTileWordCommand { id: "t1".into(), word: "paused".into() }),
        NativeCommand::SelectTileWord(TileRef { id: "t1".into() }),
        NativeCommand::VersionAction(VersionActionCommand {
            doc_path: "one".into(),
            action: VersionAction::Restore,
            version_id: Some("v1".into()),
        }),
        NativeCommand::RenameVersion(RenameVersionCommand {
            doc_path: "one".into(),
            version_id: "v1".into(),
            name: Some("First Draft".into()),
        }),
        NativeCommand::RevealSearchResult(RevealSearchResultCommand {
            doc_path: "one".into(),
            anchor: Some(anchor()),
            node_id: None,
            note_id: None,
        }),
        NativeCommand::AddReply(AddReplyCommand { doc_path: "one".into(), parent_note_id: "n1".into() }),
        NativeCommand::SetTitlebarInset(SetTitlebarInsetCommand { leading: 78.0, trailing: 52.0 }),
        NativeCommand::SetPanelInsets(SetPanelInsetsCommand { leading: 240.0, trailing: 310.0, top: 52.0 }),
        NativeCommand::OpenProject(OpenProjectCommand { project_name: "Novel".into() }),
        NativeCommand::CloseBubbleSession(CloseBubbleSessionCommand {
            session: bubble_session(),
            archive: false,
        }),
        NativeCommand::SetBlockType(SetBlockTypeCommand { target: EditorTarget::Primary, block: BlockType::Heading1 }),
        NativeCommand::SetBlockType(SetBlockTypeCommand { target: EditorTarget::Primary, block: BlockType::SceneHeading }),
        NativeCommand::SetWritingFormat(SetWritingFormatCommand { target: EditorTarget::Primary, format: WritingFormat::Screenplay }),
        NativeCommand::ToggleList(ToggleListCommand { target: EditorTarget::Primary, list: ListKind::Ordered }),
        NativeCommand::EditorHistory(EditorHistoryCommand { target: EditorTarget::Primary, action: HistoryAction::Undo }),
        NativeCommand::SetFocusMode(SetFocusModeCommand { open: true }),
        NativeCommand::SetWordCountVisible(SetWordCountVisibleCommand { visible: false }),
        NativeCommand::ArchiveAction(ArchiveActionCommand {
            doc_path: "a.md".into(),
            item_id: "x1".into(),
            action: ArchiveAction::Restore,
        }),
        NativeCommand::AddReference(AddReferenceCommand {
            id: "r1".into(),
            doc_path: Some("a".into()),
            input: "10.1038/nature14539".into(),
            cite: false,
        }),
        NativeCommand::CreateReference(CreateReferenceCommand { id: "r2".into(), doc_path: None, kind: "book".into() }),
        NativeCommand::UpdateReference(UpdateReferenceCommand {
            id: "r1".into(),
            patch: ReferencePatch { note: Some("check p. 4".into()), ..Default::default() },
        }),
        NativeCommand::DeleteReference(ReferenceRef { id: "r1".into() }),
        NativeCommand::RetryReferenceLookup(ReferenceRef { id: "r1".into() }),
        NativeCommand::ChooseReferenceCandidate(ChooseReferenceCandidateCommand { id: "r1".into(), index: 2 }),
        NativeCommand::SetReferenceAttached(SetReferenceAttachedCommand { doc_path: "a".into(), id: "r1".into(), attached: true }),
        NativeCommand::InsertCitation(InsertCitationCommand {
            target: None,
            ref_ids: vec!["r1".into()],
            locator: Some("42".into()),
        }),
        NativeCommand::InsertBibliography(InsertBibliographyCommand { target: Some(EditorTarget::Primary) }),
        NativeCommand::SetCitationStyle(SetCitationStyleCommand {
            doc_path: Some("a".into()),
            style: "mla".into(),
            make_project_default: false,
        }),
        NativeCommand::SetBibliographyOptions(SetBibliographyOptionsCommand {
            doc_path: "a".into(),
            options: bibliography_options(),
        }),
        NativeCommand::SetEditorMode(SetEditorModeCommand { mode: EditorMode::Typeset }),
        NativeCommand::MoveBookItem(MoveBookItemCommand { id: "c:Novel/One".into(), before: Some("d1".into()) }),
        NativeCommand::SetBookItemHidden(SetBookItemHiddenCommand { id: "c:Novel/One".into(), hidden: true }),
        NativeCommand::AddBookItem(AddBookItemCommand {
            matter: Some(crate::types::MatterKind::AboutAuthor),
            generated: None,
            part: false,
            before: None,
            title: None,
            back: false,
        }),
        NativeCommand::RemoveBookItem(RemoveBookItemCommand { id: "d1".into() }),
        NativeCommand::EditBookItem(EditBookItemCommand {
            id: "c:Novel/One".into(),
            title: None,
            chapter_type: Some(crate::types::ChapterType::Prologue),
            page: None,
        }),
        NativeCommand::OpenBookItem(OpenBookItemCommand { id: "d1".into() }),
        NativeCommand::ApplyBookStyle(ApplyBookStyleCommand { id: "classic".into() }),
        NativeCommand::SetChapterMeta(SetChapterMetaCommand {
            meta: crate::types::ChapterMeta { subtitle: "In which it rains".into(), ..Default::default() },
        }),
        NativeCommand::SetHeadImage(SetHeadImageCommand { target: HeadImageTarget::Ornament, path: Some("/Users/a/fleuron.png".into()) }),
        NativeCommand::SetFolderBookOptions(SetFolderBookOptionsCommand { folder: "Novel".into(), number_in_tree: Some(true), start_at: Some(0), continuous: None }),
        NativeCommand::SetTypesetView(SetTypesetViewCommand { view: TypesetView::Digital }),
        NativeCommand::SetCoverImage(SetCoverImageCommand { set_id: None, part: crate::types::CoverPart::Spine, path: Some("/Users/a/spine.png".into()) }),
        NativeCommand::EditCoverSets(EditCoverSetsCommand { action: CoverSetAction::Rename, id: Some("v1".into()), name: Some("Hardcover".into()), fit: None }),
        NativeCommand::SaveTypesetVersion(SaveTypesetVersionCommand { name: "Sent to KDP".into() }),
        NativeCommand::RestoreTypesetVersion(TypesetVersionRef { id: "v1".into() }),
        NativeCommand::RenameTypesetVersion(RenameTypesetVersionCommand { id: "v1".into(), name: "Proof 2".into() }),
        NativeCommand::DeleteTypesetVersion(TypesetVersionRef { id: "v1".into() }),
        NativeCommand::PreviewTypesetVersion(PreviewTypesetVersionCommand { id: Some("v1".into()), compare: true }),
        NativeCommand::SetPrintLayout(SetPrintLayoutCommand { enabled: true, doc_path: Some("a.md".into()) }),
        NativeCommand::SetPageSetup(SetPageSetupCommand { setup: page_setup(), target: PageSetupTarget::Book }),
        NativeCommand::SetBookSettings(SetBookSettingsCommand { settings: book() }),
        NativeCommand::SetPrintZoom(SetPrintZoomCommand { zoom: Some(1.25), fit: None, doc_path: None }),
        NativeCommand::SetDisplayDensity(SetDisplayDensityCommand { points_per_inch: 127.0 }),
        NativeCommand::InsertBreak(InsertBreakCommand { target: EditorTarget::Primary, kind: PageBreakKind::Recto }),
        NativeCommand::GoToPage(GoToPageCommand { page: 12 }),
        NativeCommand::PrintDocument(PrintDocumentCommand { scope: PrintScope::Folder, bound: true, options: PrintOptions::default() }),
        NativeCommand::PrintDocument(PrintDocumentCommand {
            scope: PrintScope::Document,
            bound: false,
            options: PrintOptions { range: PrintRange::CurrentChapter, pages: "3-7, 10".into(), watermark: "DRAFT".into(), recipients: vec![], scenes: vec![], highlight_character: "MARY".into() },
        }),
        NativeCommand::ExportDocument(ExportDocumentCommand { format: ExportFormat::Epub, scope: PrintScope::Project, bound: false, options: PrintOptions::default() }),
        NativeCommand::ExportDocument(ExportDocumentCommand { format: ExportFormat::Docx, scope: PrintScope::Folder, bound: false, options: PrintOptions::default() }),
        NativeCommand::PrintFinished(PrintFinishedCommand { job_id: "p1".into(), completed: true }),
        NativeCommand::ApplyFormat(ApplyFormatCommand { format_id: "manuscript".into(), target: PageSetupTarget::Document }),
        NativeCommand::UseSetupForBook(UseSetupForBookCommand {}),
        NativeCommand::ClearBookSetup(ClearBookSetupCommand {}),
        NativeCommand::RefreshBookChapters(RefreshBookChaptersCommand {}),
        NativeCommand::SetPrintScope(SetPrintScopeCommand { scope: PrintScope::Project }),
        NativeCommand::SetAuthorProfile(SetAuthorProfileCommand {
            profile: crate::types::AuthorProfile { byline: "A. Writer".into(), email: "a@example.com".into(), ..Default::default() },
        }),
        NativeCommand::SetBookCover(SetBookCoverCommand { path: Some("/Users/a/cover.jpg".into()) }),
        NativeCommand::ExportAgain(ExportAgainCommand {}),
        NativeCommand::SelectTab(TabRef { tab_id: "tab-1".into() }),
        NativeCommand::CloseTab(TabRef { tab_id: "tab-1".into() }),
        NativeCommand::SetTabOrder(SetTabOrderCommand { tab_ids: vec!["tab-2".into(), "tab-1".into()] }),
        NativeCommand::NewTab(NewTabCommand {}),
        NativeCommand::OpenDocInTab(OpenDocInTabCommand { doc_path: "Act One/Scene".into() }),
        NativeCommand::OpenDocInWindow(OpenDocInWindowCommand { doc_path: "Act One/Scene".into() }),
        NativeCommand::OpenInSplit(OpenInSplitCommand { doc_path: Some("Notes".into()), orientation: SplitOrientation::Columns }),
        NativeCommand::CloseSplit(CloseSplitCommand {}),
        NativeCommand::MeasureBook(MeasureBookCommand {}),
        NativeCommand::ImportScript(ImportScriptCommand {}),
        NativeCommand::SetSceneNumbers(SetSceneNumbersCommand { mode: SceneNumbering::Locked }),
        NativeCommand::ScriptReport(ScriptReportCommand { report: ScriptReportKind::Scenes, output: ReportOutput::Csv }),
    ]
}

fn bibliography_options() -> BibliographyOptions {
    BibliographyOptions { include: BibliographyInclude::Cited, annotated: true, in_print: true, title: None }
}

fn a_reference() -> Reference {
    Reference {
        id: "r1".into(),
        kind: "journalArticle".into(),
        contributors: vec![
            Contributor { role: "author".into(), family: Some("LeCun".into()), given: Some("Yann".into()), literal: None },
            Contributor { role: "author".into(), family: None, given: None, literal: Some("NASA".into()) },
        ],
        fields: [("title".to_string(), "Deep learning".to_string()), ("issued".to_string(), "2015-05-28".to_string())]
            .into_iter()
            .collect(),
        annotation: "".into(),
        note: "".into(),
        tags: vec![],
        status: ReferenceStatus::Complete,
        origin: Some(ReferenceOrigin { kind: "doi".into(), input: "10.1038/nature14539".into() }),
        candidates: vec![],
        error: None,
        created_at: "2026-09-23T12:00:00.000Z".into(),
        updated_at: "2026-09-23T12:00:00.000Z".into(),
    }
}

#[test]
fn a_reference_is_camel_case_and_keeps_csl_field_names() {
    let value = serde_json::to_value(a_reference()).unwrap();
    assert_eq!(value["createdAt"], json!("2026-09-23T12:00:00.000Z"));
    assert_eq!(value["status"], json!("complete"));
    assert_eq!(value["fields"]["title"], json!("Deep learning"));
    assert_eq!(value["contributors"][1], json!({ "role": "author", "literal": "NASA" }));
    let patch = serde_json::to_value(ReferencePatch { annotation: Some("x".into()), ..Default::default() }).unwrap();
    assert_eq!(patch, json!({ "annotation": "x" }));
}

fn bubble_session() -> BubbleSession {
    BubbleSession {
        id: "b1".into(),
        words: vec![
            BubbleWord { id: "w1".into(), text: "She".into() },
            BubbleWord { id: "w2".into(), text: "hesitated at the door".into() },
        ],
        aside: vec![BubbleAside { id: "w3".into(), text: "quietly".into(), x: 0.02, y: 0.5 }],
        original: "She quietly hesitated at the door".into(),
        mode: Some(BubbleMode::Clauses),
        forms: vec![BubbleForm {
            id: "f1".into(),
            words: vec![BubbleWord { id: "w2".into(), text: "hesitated at the door".into() }],
            aside: vec![],
            mode: None,
        }],
        unsaved: None,
    }
}

fn archived_bubble() -> ArchivedItem {
    ArchivedItem {
        id: "x1".into(),
        archived_at: "2026-09-23T12:00:00.000Z".into(),
        kind: ArchivedKind::Bubble,
        title: "She hesitated at the door".into(),
        bubble: Some(bubble_session()),
    }
}

#[test]
fn an_archived_item_is_camel_case_and_names_its_kind() {
    let value = serde_json::to_value(archived_bubble()).unwrap();
    assert_eq!(value["archivedAt"], json!("2026-09-23T12:00:00.000Z"));
    assert_eq!(value["kind"], json!("bubble"));
    assert_eq!(value["bubble"]["id"], json!("b1"));
    let bare: ArchivedItem = serde_json::from_value(
        json!({ "id": "x2", "archivedAt": "", "kind": "bubble", "title": "" }),
    ).unwrap();
    assert_eq!(bare.bubble, None);
}

fn map_button(id: &str, label: &str) -> MapPanelButton {
    MapPanelButton {
        id: id.into(),
        label: label.into(),
        role: MapButtonRole::Normal,
        disabled: false,
        symbol: None,
        help: None,
    }
}

/// A map's chrome with one of every kind of field, so each is on the wire at least once.
fn map_chrome() -> MapChromeState {
    let fields = vec![
        MapPanelField::Text(MapTextInput {
            id: "pin.name".into(),
            label: "Name".into(),
            value: "Harrowgate".into(),
            placeholder: None,
            multiline: false,
            focus_key: 0,
        }),
        MapPanelField::Number(MapNumberInput {
            id: "route.width".into(),
            label: "Width".into(),
            value: Some(2.5),
            min: Some(0.5),
            max: Some(20.0),
            step: Some(0.5),
            suffix: Some("px".into()),
            allow_empty: false,
            help: None,
        }),
        MapPanelField::Choice(MapChoiceInput {
            id: "route.dash".into(),
            label: "Style".into(),
            value: "solid".into(),
            options: vec![MapChoice { value: "solid".into(), label: "Solid".into(), group: None }],
            help: None,
        }),
        MapPanelField::Toggle(MapToggleInput { id: "route.arrow".into(), label: "Arrow at end".into(), value: false }),
        MapPanelField::Color(MapColorInput { id: "pin.color".into(), label: "Colour".into(), value: None, fallback: "#c0392b".into() }),
        MapPanelField::Stat(MapStatRow { label: "Length".into(), value: "42 km".into(), action: None }),
        MapPanelField::Note(MapNoteText { text: "Tip".into(), tone: MapNoteTone::Warning, swatch: None, action: None }),
        MapPanelField::Button(map_button("pin.open", "Open")),
        MapPanelField::Buttons(MapButtonRow { buttons: vec![map_button("theme.clean", "Clean")] }),
        MapPanelField::ListRow(MapListRow { id: "places.p1".into(), title: "Harrowgate".into(), subtitle: None, swatch: None, indent: 0 }),
        MapPanelField::Markers(MapMarkerInput {
            id: "pin.icon".into(),
            value: "city".into(),
            color: None,
            options: vec![MapChoice { value: "city".into(), label: "City".into(), group: None }],
        }),
        MapPanelField::Date(MapDateInput {
            id: "traveler.startDay".into(),
            label: "On".into(),
            value: Some(MapDateParts { year: 1850.0, month: 3.0, day: 1.0, hour: 9.0, minute: 30.0 }),
            mode: MapCalendarMode::Gregorian,
            months: vec!["January".into()],
            allow_empty: false,
            placeholder: None,
        }),
        MapPanelField::Table(MapTableView {
            columns: vec!["Harrowgate".into()],
            rows: vec![MapTableRowView {
                label: "Harrowgate".into(),
                cells: vec![MapTableCell { text: "—".into(), detail: None, strong: false }],
            }],
        }),
        MapPanelField::Preview(MapShapePreview { width: 100.0, height: 50.0, path: "M0 0L10 10Z".into(), filled: true }),
        MapPanelField::Group(MapPanelGroup {
            id: "leg.l1".into(),
            title: "Leg 1".into(),
            swatch: None,
            actions: vec![map_button("leg.l1.remove", "×")],
            fields: vec![],
            collapsible: false,
        }),
    ];
    MapChromeState {
        surface_id: "map-surface-0".into(),
        doc_path: "World.map".into(),
        tool: MapTool::Pin,
        zoom: 2.5,
        zoom_label: "250%".into(),
        can_undo: true,
        can_redo: false,
        has_selection: true,
        panel: MapPanel {
            title: "Place".into(),
            can_go_back: true,
            problems: 0,
            tabs: vec![],
            tab: None,
            sections: vec![MapPanelSection { id: "place".into(), title: "Place".into(), actions: vec![], fields }],
        },
        reveal_panel: 1,
        active: true,
    }
}

fn every_event() -> Vec<WebviewEvent> {
    let marker = NoteMarkerEvent {
        note_id: "n1".into(),
        doc_path: "chapters/one.md".into(),
        anchor_left: 1.0,
        anchor_top: 2.0,
        anchor_right: 3.0,
        anchor_bottom: 4.0,
        note: None,
    };

    vec![
        WebviewEvent::ToolbarState(ToolbarState {
            target: Some(EditorTarget::Primary),
            color: "#000000".into(),
            highlight: "#ffff00".into(),
            font: "Georgia".into(),
            font_size: "18px".into(),
            alignment: Alignment::Left,
            block_type: BlockType::Heading2,
            writing_format: WritingFormat::Prose,
            active_marks: ActiveMarks::default(),
            can_undo: true,
            can_redo: false,
            last_highlight_color: "#ffff00".into(),
        }),
        WebviewEvent::SelectionContext(SelectionContext {
            target: Some(EditorTarget::Primary),
            doc_path: Some("chapters/one.md".into()),
            anchor: anchor(),
            empty: false,
            touches_highlight: false,
            is_canvas: false,
        }),
        WebviewEvent::DocChanged(DocChanged {
            pane: Pane::Primary,
            doc_path: "chapters/one.md".into(),
            user_edit: true,
            word_count: 120,
            char_count: 640,
            inserted: 3,
            deleted: 1,
            paste: false,
        }),
        WebviewEvent::NotesRemapped(NotesRemapped {
            doc_path: "chapters/one.md".into(),
            notes: Vec::new(),
            dropped_note_ids: vec!["n9".into()],
        }),
        WebviewEvent::NoteMarkerHover(marker.clone()),
        WebviewEvent::NoteMarkerLeave(marker.clone()),
        WebviewEvent::NoteMarkerPin(marker),
        WebviewEvent::ActiveEditorChanged(ActiveEditorChanged {
            target: Some(EditorTarget::Primary),
            doc_path: None,
            surface_id: None,
        }),
        WebviewEvent::CanvasToolbarChanged(CanvasToolbarChanged {
            state: Some(CanvasToolbarState {
                surface_id: "canvas-surface-0".into(),
                zoom: 1.25,
                can_undo: true,
                can_redo: false,
                has_selection: true,
                can_group: true,
                can_ungroup: false,
                locked: false,
                alignment_guides: true,
                snap_to_grid: false,
                can_record: true,
                is_recording: false,
                record_elapsed_ms: 0.0,
            }),
        }),
        WebviewEvent::MapChromeChanged(MapChromeChanged { state: Some(map_chrome()) }),
        WebviewEvent::SearchMatches(SearchMatches {
            query: "hesitated".into(),
            doc_path: "chapters/one.md".into(),
            results: Vec::new(),
            active_index: Some(0),
        }),
        WebviewEvent::FocusModeView(FocusModeView {
            active: true,
            doc_path: "chapters/one.md".into(),
            paragraph_index: 2,
            paragraph_count: 9,
            word_count: 120,
        }),
        WebviewEvent::ReadAloudPayload(ReadAloudPayloadEvent {
            doc_path: "chapters/one.md".into(),
            payload: Default::default(),
        }),
        WebviewEvent::DragStarted(DragStarted {
            drag_id: "d1".into(),
            kind: DragPayloadKind::EditorSelection,
            text: "she hesitated".into(),
            source_id: None,
            doc_path: Some("chapters/one.md".into()),
            anchor: Some(anchor()),
            detail: None,
        }),
        WebviewEvent::DragMoved(DragMoved {
            drag_id: "d1".into(),
            client_x: 5.0,
            client_y: 6.0,
        }),
        WebviewEvent::DragEnded(DragEnded {
            drag_id: "d1".into(),
            handled: true,
            client_x: Some(5.0),
            client_y: Some(6.0),
        }),
        WebviewEvent::ProjectChanged(ProjectChanged {
            project_name: Some("Novel".into()),
            project_root: Some("/Users/me/Novel".into()),
        }),
        WebviewEvent::NotesChanged(NotesChanged { doc_path: "one".into(), notes: Vec::new() }),
        WebviewEvent::ClipboardChanged(ClipboardChanged {
            entries: vec![ClipboardEntry {
                id: "c1".into(),
                text: "copied".into(),
                doc_name: "one".into(),
                timestamp: "2026-09-22T12:00:00.000Z".into(),
            }],
        }),
        WebviewEvent::TilesChanged(TilesChanged {
            tiles: vec![WorkbenchTile {
                id: "1758556800000".into(),
                kind: TileKind::Synonym,
                text: "hesitated".into(),
                doc: Some("one".into()),
            }],
        }),
        WebviewEvent::VersionsChanged(VersionsChanged { doc_path: "one".into() }),
        WebviewEvent::ShowSidebarTab(ShowSidebarTab { tab: SidebarTab::History }),
        WebviewEvent::NoteMarkerMoved(NoteMarkerEvent {
            note_id: "n1".into(),
            doc_path: "chapters/one.md".into(),
            anchor_left: 1.0,
            anchor_top: 2.0,
            anchor_right: 3.0,
            anchor_bottom: 4.0,
            note: None,
        }),
        WebviewEvent::NotePreviewDismissed(NotePreviewDismissed { note_id: "n1".into() }),
        WebviewEvent::NoteMarkersChanged(NoteMarkersChanged {
            markers: vec![NoteMarkerRect {
                note_id: "n1".into(),
                color: "#ffd54f".into(),
                left: 10.0,
                top: 20.0,
                right: 18.0,
                bottom: 28.0,
            }],
        }),
        WebviewEvent::BubbleSessionOpened(BubbleSessionOpened {
            doc_path: "chapters/one.md".into(),
            session: bubble_session(),
        }),
        WebviewEvent::BubbleChipsChanged(BubbleChipsChanged {
            chips: vec![BubbleChipRect {
                session_id: "b1".into(), left: 1.0, top: 2.0, right: 23.0, bottom: 18.0, form_page: 1, form_pages: 3,
            }],
        }),
        WebviewEvent::ViewOptions(ViewOptions { focus_mode: false, word_count_visible: true }),
        WebviewEvent::WordCountsChanged(WordCountsChanged {
            badges: vec![WordCountBadge {
                text: "12 words".into(), left: 600.0, top: 700.0, right: 660.0, bottom: 722.0,
            }],
            panes: vec![PaneStatus {
                pane: Pane::Secondary, doc_path: "a.md".into(), print_layout: true, zoom: 1.25, hovered: true,
                left: 400.0, top: 700.0, right: 800.0, bottom: 722.0,
            }],
        }),
        WebviewEvent::ArchiveChanged(ArchiveChanged {
            doc_path: "a.md".into(),
            items: vec![archived_bubble()],
        }),
        WebviewEvent::ReferencesChanged(ReferencesChanged {
            doc_path: Some("a".into()),
            style: "apa".into(),
            project_style: "apa".into(),
            bibliography: bibliography_options(),
            has_bibliography: true,
            references: vec![ReferenceView {
                reference: a_reference(),
                entry_html: "LeCun, Y. (2015). Deep learning. <i>Nature</i>.".into(),
                entry_text: "LeCun, Y. (2015). Deep learning. Nature.".into(),
                in_text: "(LeCun, 2015)".into(),
                missing_fields: vec![],
                used_in: vec!["a".into()],
                attached: true,
                cited: true,
            }],
        }),
        WebviewEvent::ReferenceSchema(ReferenceSchema {
            kinds: vec![ReferenceKindSpec {
                id: "book".into(),
                label: "Book".into(),
                group: "Books".into(),
                symbol: "book.closed".into(),
                fields: vec![ReferenceFieldSpec {
                    key: "title".into(),
                    label: "Title".into(),
                    placeholder: "".into(),
                    input: ReferenceFieldInput::Text,
                    required: true,
                }],
                roles: vec!["author".into()],
            }],
            roles: vec![ContributorRoleSpec { id: "author".into(), label: "Author".into() }],
            styles: vec![CitationStyleSpec {
                id: "apa".into(),
                label: "APA 7th edition".into(),
                short: "APA".into(),
                heading: "References".into(),
                note_style: false,
            }],
        }),
        WebviewEvent::RevealReference(RevealReference { id: "r1".into() }),
        WebviewEvent::PageLayoutState(PageLayoutState {
            enabled: true,
            mode: EditorMode::Typeset,
            typeset_view: TypesetView::Print,
            doc_path: Some("Manuscript/one".into()),
            setup: page_setup(),
            ready: true,
            setup_source: SetupSource::Document,
            has_own_setup: true,
            format_id: Some("trade-6x9".into()),
            format_modified: false,
            page_count: 212,
            current_page: 3,
            zoom: 1.0,
            scope: PrintScope::Folder,
            book: book(),
            book_setup_active: true,
            book_chapters: vec!["Manuscript/one".into(), "Manuscript/two".into()],
            book_items: vec![BookRow {
                id: "c:Manuscript/one".into(),
                kind: crate::types::BookItemKind::Chapter,
                title: "one".into(),
                path: Some("Manuscript/one".into()),
                hidden: false,
                matter: None,
                generated: None,
                chapter_type: None,
                number: Some(1),
                label: Some("Chapter One".into()),
                section: BookRowSection::Body,
                part: None,
                page: crate::types::PageOptions::default(),
                legacy: false,
            }],
            selected_book_item: Some("c:Manuscript/one".into()),
            chapter_meta: Some(crate::types::ChapterMeta { subtitle: "In which it rains".into(), ..Default::default() }),
            cover: Some(CoverState {
                sets: vec![],
                active: None,
                trim_width_mm: 152.4,
                trim_height_mm: 228.6,
                spine_width_mm: 12.4,
                bleed_mm: 3.175,
                wrap_width_mm: 323.55,
                wrap_height_mm: 234.95,
                page_count: 220,
                checks: vec![],
                showing: false,
            }),
            chapter_image_file: None,
            ornament_image_file: None,
            suggested_inside_margin_mm: 12.7,
            author: crate::types::AuthorProfile { byline: "A. Writer".into(), ..Default::default() },
            word_count: 71_400,
            cover_file: Some("/Users/a/Novel/.assets/ab12.jpg".into()),
            last_export: Some(LastExport { format: ExportFormat::Docx, scope: PrintScope::Folder, path: "/Users/a/Book.docx".into() }),
            has_selection: true,
            publishing: Some(PublishingReport {
                page_count: 212,
                measured: true,
                words: 71_400,
                reading_minutes: 286,
                spine_width_mm: 13.5,
                spine_text: true,
                issues: vec![PreflightIssue {
                    id: "gutter".into(),
                    severity: PreflightSeverity::Error,
                    message: "The inside margin is too narrow for 212 pages.".into(),
                    fix_label: Some("Widen the Gutter".into()),
                    fixed_setup: Some(page_setup()),
                }],
            }),
            script: Some(ScriptSummary {
                format: WritingFormat::Screenplay,
                scene_numbers: SceneNumbering::Locked,
                characters: vec!["MARY".into(), "JOHN".into()],
                scenes: vec![SceneSummary { number: Some("12A".into()), heading: "INT. KITCHEN - NIGHT".into(), page: 14 }],
            }),
        }),
        WebviewEvent::PrintRequest(PrintRequest {
            job_id: "p1".into(),
            job_name: "The Book".into(),
            paper_width_pt: 612.0,
            paper_height_pt: 792.0,
            pdf_path: None,
        }),
        WebviewEvent::PageLayoutCatalog(PageLayoutCatalog {
            presets: vec![PageSizeOption { id: "a4".into(), label: "A4".into(), group: "ISO A".into(), width_mm: 210.0, height_mm: 297.0 }],
            formats: vec![FormatOption {
                id: "manuscript".into(),
                label: "Standard Manuscript".into(),
                group: "Submission".into(),
                summary: "What agents and editors ask for.".into(),
                kind: FormatKind::Prose,
            }],
            signature_advice: vec![SignatureAdvice { sheets: 4, label: "Standard".into() }],
            tokens: vec![RunningToken { token: "{page}".into(), label: "Page Number".into() }],
            default_typography: typography(),
            book_styles: vec![],
        }),
        WebviewEvent::PrintJobStatus(PrintJobStatus {
            job_id: "p1".into(),
            kind: PrintJobKind::Export,
            format: Some(ExportFormat::Pdf),
            phase: PrintJobPhase::Laying,
            done: Some(2),
            total: Some(14),
            message: None,
            path: None,
        }),
        WebviewEvent::TypesetFocus(TypesetFocus { section_id: "page.size".into() }),
        WebviewEvent::TypesetHistoryChanged(TypesetHistoryChanged {
            folder: "Novel".into(),
            rows: vec![TypesetVersionRow {
                id: "v1".into(),
                timestamp: "2026-09-26T12:00:00Z".into(),
                kind: TypesetVersionKind::Export,
                name: Some("Exported PDF".into()),
                summary: vec!["Inside margin 19 mm → 22 mm".into()],
            }],
            previewing: None,
            comparing: false,
            note: None,
        }),
        WebviewEvent::TabsChanged(TabsChanged {
            tabs: vec![
                DocTab { id: "tab-1".into(), doc_path: Some("Act One/Scene".into()), secondary_doc: Some("Notes".into()), split: Some(SplitOrientation::Rows) },
                DocTab { id: "tab-2".into(), doc_path: None, secondary_doc: None, split: None },
            ],
            active_tab_id: Some("tab-1".into()),
        }),
    ]
}

#[test]
fn every_command_has_its_documented_wire_name() {
    let names: Vec<String> = every_command().iter().map(tag_of).collect();

    assert_eq!(
        names,
        vec![
            "applyMark",
            "setColor",
            "setHighlight",
            "setFontFamily",
            "setFontSize",
            "setAlignment",
            "insertTable",
            "insertConversationTile",
            "openDocument",
            "setSelection",
            "jumpToAnchor",
            "setContent",
            "replaceRanges",
            "setCaretAtDocPos",
            "dictationPartial",
            "dictationFinal",
            "dictationLevel",
            "dictationCancel",
            "syncNotes",
            "canvasCommand",
            "mapCommand",
            "canvasDropDoc",
            "canvasDropNote",
            "canvasReveal",
            "canvasRestore",
            "insertPlainText",
            "createEntry",
            "renameEntry",
            "moveEntry",
            "deleteEntry",
            "duplicateEntry",
            "updateNote",
            "removeNote",
            "jumpToNote",
            "highlightNote",
            "clipboardDrop",
            "removeClipboardEntries",
            "insertClipboardEntry",
            "removeTiles",
            "replaceTileWord",
            "selectTileWord",
            "versionAction",
            "renameVersion",
            "revealSearchResult",
            "addReply",
            "setTitlebarInset",
            "setPanelInsets",
            "openProject",
            "closeBubbleSession",
            "setBlockType",
            "setBlockType",
            "setWritingFormat",
            "toggleList",
            "editorHistory",
            "setFocusMode",
            "setWordCountVisible",
            "archiveAction",
            "addReference",
            "createReference",
            "updateReference",
            "deleteReference",
            "retryReferenceLookup",
            "chooseReferenceCandidate",
            "setReferenceAttached",
            "insertCitation",
            "insertBibliography",
            "setCitationStyle",
            "setBibliographyOptions",
            "setEditorMode",
            "moveBookItem",
            "setBookItemHidden",
            "addBookItem",
            "removeBookItem",
            "editBookItem",
            "openBookItem",
            "applyBookStyle",
            "setChapterMeta",
            "setHeadImage",
            "setFolderBookOptions",
            "setTypesetView",
            "setCoverImage",
            "editCoverSets",
            "saveTypesetVersion",
            "restoreTypesetVersion",
            "renameTypesetVersion",
            "deleteTypesetVersion",
            "previewTypesetVersion",
            "setPrintLayout",
            "setPageSetup",
            "setBookSettings",
            "setPrintZoom",
            "setDisplayDensity",
            "insertBreak",
            "goToPage",
            "printDocument",
            "printDocument",
            "exportDocument",
            "exportDocument",
            "printFinished",
            "applyFormat",
            "useSetupForBook",
            "clearBookSetup",
            "refreshBookChapters",
            "setPrintScope",
            "setAuthorProfile",
            "setBookCover",
            "exportAgain",
            "selectTab",
            "closeTab",
            "setTabOrder",
            "newTab",
            "openDocInTab",
            "openDocInWindow",
            "openInSplit",
            "closeSplit",
            "measureBook",
            "importScript",
            "setSceneNumbers",
            "scriptReport",
        ]
    );
}

#[test]
fn every_event_has_its_documented_wire_name() {
    let names: Vec<String> = every_event().iter().map(tag_of).collect();

    assert_eq!(
        names,
        vec![
            "toolbarState",
            "selectionContext",
            "docChanged",
            "notesRemapped",
            "noteMarkerHover",
            "noteMarkerLeave",
            "noteMarkerPin",
            "activeEditorChanged",
            "canvasToolbarChanged",
            "mapChromeChanged",
            "searchMatches",
            "focusModeView",
            "readAloudPayload",
            "dragStarted",
            "dragMoved",
            "dragEnded",
            "projectChanged",
            "notesChanged",
            "clipboardChanged",
            "tilesChanged",
            "versionsChanged",
            "showSidebarTab",
            "noteMarkerMoved",
            "notePreviewDismissed",
            "noteMarkersChanged",
            "bubbleSessionOpened",
            "bubbleChipsChanged",
            "viewOptions",
            "wordCountsChanged",
            "archiveChanged",
            "referencesChanged",
            "referenceSchema",
            "revealReference",
            "pageLayoutState",
            "printRequest",
            "pageLayoutCatalog",
            "printJobStatus",
            "typesetFocus",
            "typesetHistoryChanged",
            "tabsChanged",
        ]
    );
}

#[test]
fn every_command_survives_a_round_trip() {
    for command in every_command() {
        round_trip(&command);
    }
}

#[test]
fn every_event_survives_a_round_trip() {
    for event in every_event() {
        round_trip(&event);
    }
}

#[test]
fn every_request_and_reply_survives_a_round_trip() {
    let requests = vec![
        BridgeRequest::GetSelectionContext(EditorQuery::default()),
        BridgeRequest::GetToolbarState(EditorQuery { target: Some(EditorTarget::Secondary) }),
        BridgeRequest::GetReadAloudPayload(ReadAloudQuery {
            target: None,
            selection_only: true,
        }),
        BridgeRequest::GetDocumentText(EditorQuery::default()),
    ];
    let names: Vec<String> = requests.iter().map(tag_of).collect();
    assert_eq!(
        names,
        vec!["getSelectionContext", "getToolbarState", "getReadAloudPayload", "getDocumentText"]
    );
    for request in &requests {
        round_trip(request);
    }

    let reply = BridgeReply::Error(BridgeError {
        code: BridgeErrorCode::NoEditor,
        message: "no live editor".into(),
    });
    assert_eq!(
        serde_json::to_value(&reply).unwrap(),
        json!({
            "type": "error",
            "payload": { "code": "noEditor", "message": "no live editor" }
        })
    );
    round_trip(&reply);
}

/* ---------------- the anchor rule ---------------- */

/// The rule the protocol is built on: nothing carries a bare position. Every message
/// that addresses a place in a document addresses it with a `TextAnchor`, which means
/// every one of them carries the text to re-resolve by.
///
/// The exception is deliberate and is exactly one: `setCaretAtDocPos` takes a raw
/// position, because a caret has no text to be about. It is named here so that the
/// exception stays at one.
#[test]
fn only_set_caret_addresses_a_document_by_bare_position() {
    let carries_bare_position = |command: &NativeCommand| {
        fn scan(value: &Value, inside_anchor: bool) -> bool {
            match value {
                Value::Object(map) => map.iter().any(|(key, child)| {
                    if !inside_anchor && (key == "from" || key == "to" || key == "pos") {
                        return true;
                    }
                    scan(child, inside_anchor || key == "anchor")
                }),
                Value::Array(items) => items.iter().any(|item| scan(item, inside_anchor)),
                _ => false,
            }
        }
        scan(&serde_json::to_value(command).unwrap(), false)
    };

    let offenders: Vec<String> = every_command()
        .iter()
        .filter(|command| carries_bare_position(command))
        .map(tag_of)
        .collect();

    assert_eq!(offenders, vec!["setCaretAtDocPos"]);
}

#[test]
fn a_caret_anchor_is_empty_and_carries_no_text() {
    let caret = TextAnchor::caret(12);
    assert!(caret.is_empty());
    assert_eq!(caret.from, 12);
    assert_eq!(caret.to, 12);
    assert_eq!(caret.text, "");
}

#[test]
fn an_anchor_over_text_is_not_empty() {
    assert!(!anchor().is_empty());
}

/// A sequence gap is the thing `seq` exists to make visible, so the field has to
/// survive the round trip that a dropped message would otherwise hide.
#[test]
fn envelope_sequence_numbers_survive_the_wire() {
    let outbound = OutboundMessage::Event(EventEnvelope {
        seq: 41,
        event: WebviewEvent::DocChanged(DocChanged {
            pane: Pane::Primary,
            doc_path: "chapters/one.md".into(),
            user_edit: true,
            word_count: 1,
            char_count: 2,
            inserted: 0,
            deleted: 0,
            paste: true,
        }),
    });

    let OutboundMessage::Event(envelope) = round_trip(&outbound) else {
        panic!("an event envelope came back as something else");
    };
    assert_eq!(envelope.seq, 41);
}

#[test]
fn a_bubble_session_is_camel_case_and_an_empty_aside_may_be_omitted() {
    let session = bubble_session();
    let value = serde_json::to_value(&session).unwrap();
    assert_eq!(value["words"][1], json!({ "id": "w2", "text": "hesitated at the door" }));
    assert_eq!(value["aside"][0], json!({ "id": "w3", "text": "quietly", "x": 0.02, "y": 0.5 }));
    assert_eq!(value["mode"], json!("clauses"));
    assert_eq!(value["forms"][0], json!({
        "id": "f1", "words": [{ "id": "w2", "text": "hesitated at the door" }], "aside": [],
    }));

    // A session written before anything was set aside, or any form saved, still reads.
    let bare: BubbleSession =
        serde_json::from_value(json!({ "id": "b2", "words": [], "original": "" })).unwrap();
    assert!(bare.aside.is_empty());
    assert_eq!(bare.mode, None);
    assert!(bare.forms.is_empty());
    assert!(serde_json::to_value(&bare).unwrap().get("forms").is_none());
    assert_eq!(bare.unsaved, None);
}

#[test]
fn the_toolbar_items_speak_camel_case() {
    let command = NativeCommand::SetBlockType(SetBlockTypeCommand { target: EditorTarget::Primary, block: BlockType::Heading2 });
    assert_eq!(
        serde_json::to_value(&command).unwrap(),
        json!({ "type": "setBlockType", "payload": { "target": "primary", "block": "heading2" } })
    );
    let event = WebviewEvent::ViewOptions(ViewOptions { focus_mode: true, word_count_visible: false });
    assert_eq!(
        serde_json::to_value(&event).unwrap(),
        json!({ "type": "viewOptions", "payload": { "focusMode": true, "wordCountVisible": false } })
    );
}

#[test]
fn a_page_setup_crosses_the_wire_in_millimetres_and_camel_case() {
    let command = NativeCommand::SetPageSetup(SetPageSetupCommand { setup: page_setup(), target: PageSetupTarget::Document });
    let wire = serde_json::to_value(&command).unwrap();
    assert_eq!(wire["type"], "setPageSetup");
    let setup = &wire["payload"]["setup"];
    assert_eq!(setup["presetId"], "trade-6x9");
    assert_eq!(setup["widthMm"], 152.4);
    assert_eq!(setup["margins"]["gutterMm"], 3.175);
    assert_eq!(setup["pageNumberFormat"], "arabic");
    assert_eq!(setup["versoHeader"]["center"], "{title}");
    // An absent override is absent, not null: the page tests `setup.versoFooter`.
    assert!(setup.get("versoFooter").is_none());
}

#[test]
fn a_page_setup_without_verso_overrides_still_reads() {
    let mut wire = serde_json::to_value(page_setup()).unwrap();
    wire.as_object_mut().unwrap().remove("versoHeader");
    let setup: crate::types::PageSetup = serde_json::from_value(wire).unwrap();
    assert!(setup.verso_header.is_none());
}

#[test]
fn a_page_setup_edit_from_an_older_shell_goes_to_the_document() {
    let wire = json!({ "type": "setPageSetup", "payload": { "setup": serde_json::to_value(page_setup()).unwrap() } });
    let command: NativeCommand = serde_json::from_value(wire).unwrap();
    match command {
        NativeCommand::SetPageSetup(edit) => assert_eq!(edit.target, PageSetupTarget::Document),
        other => panic!("read as {other:?}"),
    }
}

#[test]
fn a_job_status_leaves_out_what_it_does_not_have() {
    let event = WebviewEvent::PrintJobStatus(PrintJobStatus {
        job_id: "p1".into(),
        kind: PrintJobKind::Print,
        format: None,
        phase: PrintJobPhase::Done,
        done: None,
        total: None,
        message: None,
        path: None,
    });
    assert_eq!(
        serde_json::to_value(&event).unwrap(),
        json!({ "type": "printJobStatus", "payload": { "jobId": "p1", "kind": "print", "phase": "done" } })
    );
}

#[test]
fn a_page_setup_carries_its_typography_in_camel_case() {
    use crate::types::{ChapterOpening, LineSpacing, PrintAlignment, PrintTypography, TitlePageOptions, TitlePageStyle};
    let mut setup = page_setup();
    setup.typography = Some(PrintTypography {
        font_family: "\"Courier Prime\", Courier, monospace".into(),
        font_size_pt: 12.0,
        line_spacing: LineSpacing::Double,
        line_value: 2.0,
        first_line_indent_mm: 12.7,
        paragraph_spacing_pt: 0.0,
        alignment: PrintAlignment::Left,
        hyphenate: false,
        scene_break: "#".into(),
        chapter_opening: ChapterOpening::DropCapAndSmallCaps,
        chapter_sink_mm: 76.2,
        no_indent_after_break: true,
        images: None,
    });
    setup.title_page = Some(TitlePageOptions { style: TitlePageStyle::Manuscript, show_contact: true, show_word_count: true });
    let wire = serde_json::to_value(&setup).unwrap();
    assert_eq!(wire["typography"]["lineSpacing"], "double");
    assert_eq!(wire["typography"]["chapterOpening"], "dropCapAndSmallCaps");
    assert_eq!(wire["titlePage"]["style"], "manuscript");
    round_trip(&setup);
}

#[test]
fn a_script_element_is_a_block_type_and_an_old_toolbar_is_prose() {
    assert_eq!(serde_json::to_value(BlockType::StageDirection).unwrap(), "stageDirection");
    assert_eq!(serde_json::to_value(WritingFormat::Stageplay).unwrap(), "stageplay");
    let mut toolbar = serde_json::to_value(every_event().into_iter().find_map(|e| match e {
        WebviewEvent::ToolbarState(state) => Some(state),
        _ => None,
    }).unwrap()).unwrap();
    toolbar.as_object_mut().unwrap().remove("writingFormat");
    let read: ToolbarState = serde_json::from_value(toolbar).unwrap();
    assert_eq!(read.writing_format, WritingFormat::Prose);
}

#[test]
fn a_print_from_an_older_shell_has_no_options() {
    let old: PrintDocumentCommand = serde_json::from_value(json!({ "scope": "document", "bound": false })).unwrap();
    assert_eq!(old.options, PrintOptions::default());
    let wire = serde_json::to_value(ExportFormat::PlainText).unwrap();
    assert_eq!(wire, "plainText");
    assert_eq!(serde_json::to_value(ExportFormat::Fountain).unwrap(), "fountain");
    assert_eq!(serde_json::to_value(ExportFormat::Fdx).unwrap(), "fdx");
    let partial: PrintOptions = serde_json::from_value(json!({ "watermark": "DRAFT" })).unwrap();
    assert_eq!(partial.range, PrintRange::All);
    assert!(partial.pages.is_empty());
    assert!(partial.scenes.is_empty() && partial.highlight_character.is_empty());
    let sides: PrintOptions = serde_json::from_value(json!({ "range": "scenes", "scenes": [2, 5], "highlightCharacter": "MARY" })).unwrap();
    assert_eq!((sides.range, sides.scenes, sides.highlight_character.as_str()), (PrintRange::Scenes, vec![2, 5], "MARY"));
}

#[test]
fn a_book_saved_before_compiling_reads_with_everything_in() {
    let mut old = serde_json::to_value(book()).unwrap();
    for key in ["excluded", "chapterNumbering", "frontMatter", "backMatter"] {
        old.as_object_mut().unwrap().remove(key);
    }
    let read: crate::types::BookSettings = serde_json::from_value(old).unwrap();
    assert!(read.excluded.is_empty());
    assert_eq!(read.chapter_numbering.style, crate::types::ChapterNumberStyle::None);
    assert!(!read.front_matter.contents);
    let wire = serde_json::to_value(book()).unwrap();
    assert_eq!(wire["chapterNumbering"]["style"], "words");
    assert_eq!(wire["frontMatter"]["halfTitle"], true);
    assert_eq!(wire["backMatter"]["aboutTheAuthor"], "A. Writer lives by the sea.");
}

#[test]
fn a_book_saved_before_typesetting_reads_with_no_design_contents_or_covers() {
    let mut old = serde_json::to_value(book()).unwrap();
    for key in ["chapterDesign", "partDesign", "items", "continuous", "covers", "activeCover"] {
        old.as_object_mut().unwrap().remove(key);
    }
    old["chapterNumbering"].as_object_mut().unwrap().remove("startAt");
    old["chapterNumbering"].as_object_mut().unwrap().remove("showInTree");
    let read: crate::types::BookSettings = serde_json::from_value(old).unwrap();
    assert!(read.chapter_design.is_none() && read.items.is_empty() && read.covers.is_empty());
    assert!(!read.continuous);
    assert_eq!(read.chapter_numbering.start_at, 1, "an old book counts from one");
    assert!(!read.chapter_numbering.show_in_tree);

    let wire = serde_json::to_value(book()).unwrap();
    assert_eq!(wire["chapterDesign"]["chapterBreak"], "newRightPage");
    assert_eq!(wire["chapterDesign"]["ornament"], "glyph");
    assert_eq!(wire["items"][0]["matter"], "dedication");
    assert_eq!(wire["items"][0]["page"]["position"], "sunk");
    assert_eq!(wire["items"][1]["chapterType"], "prologue");
    assert_eq!(wire["covers"][0]["madeForSpineMm"], 12.4);
    let design: crate::types::ChapterDesign = serde_json::from_value(json!({ "showNumber": true })).unwrap();
    assert!(design.show_title && design.show_number, "a partial design fills the rest in");
    assert_eq!(design.chapter_break, crate::types::ChapterBreak::NewPage);
}

#[test]
fn an_author_profile_missing_fields_reads_as_blank() {
    let profile: crate::types::AuthorProfile = serde_json::from_value(json!({ "byline": "A. Writer" })).unwrap();
    assert_eq!(profile.byline, "A. Writer");
    assert!(profile.email.is_empty());
}

#[test]
fn a_map_panel_field_is_type_and_payload_in_camel_case() {
    let field = MapPanelField::ListRow(MapListRow {
        id: "places.p1".into(),
        title: "Harrowgate".into(),
        subtitle: None,
        swatch: Some("#aa3322".into()),
        indent: 1,
    });
    assert_eq!(
        serde_json::to_value(&field).unwrap(),
        json!({
            "type": "listRow",
            "payload": { "id": "places.p1", "title": "Harrowgate", "swatch": "#aa3322", "indent": 1 }
        })
    );
}

#[test]
fn a_map_tool_and_its_chrome_speak_camel_case() {
    let value = serde_json::to_value(map_chrome()).unwrap();
    assert_eq!(value["tool"], json!("pin"));
    assert_eq!(value["surfaceId"], json!("map-surface-0"));
    assert_eq!(value["revealPanel"], json!(1));
    assert_eq!(value["panel"]["canGoBack"], json!(true));
    assert_eq!(value["panel"]["sections"][0]["fields"][0]["payload"]["focusKey"], json!(0));
    // A panel with no tab chosen says nothing about one.
    assert!(value["panel"].get("tab").is_none());
}
