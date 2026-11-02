//! One of everything for the bridge tests: a page setup, a book, an anchor, and an
//! instance of every command and every event (`every_command` / `every_event`, which
//! the exhaustive wire-name tests in `mod.rs` walk).

use super::*;

pub(super) fn page_setup() -> crate::types::PageSetup {
    use crate::types::{PageMargins, PageNumberFormat, PageOrientation, PageSetup, RunningText};
    let blank = RunningText {
        left: String::new(),
        center: String::new(),
        right: String::new(),
    };
    PageSetup {
        preset_id: "trade-6x9".into(),
        width_mm: 152.4,
        height_mm: 228.6,
        orientation: PageOrientation::Portrait,
        margins: PageMargins {
            top_mm: 19.05,
            bottom_mm: 19.05,
            inside_mm: 15.875,
            outside_mm: 15.875,
            gutter_mm: 3.175,
        },
        mirror_margins: true,
        columns: 1,
        column_gap_mm: 6.35,
        header: RunningText {
            left: String::new(),
            center: "{chapter}".into(),
            right: String::new(),
        },
        footer: RunningText {
            left: String::new(),
            center: "{page}".into(),
            right: String::new(),
        },
        verso_header: Some(RunningText {
            center: "{title}".into(),
            ..blank.clone()
        }),
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

pub(super) fn typography() -> crate::types::PrintTypography {
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
        composition: Some(crate::types::Composition {
            baseline_grid: true,
            ..Default::default()
        }),
        features: None,
    }
}

pub(super) fn book() -> crate::types::BookSettings {
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
        front_matter: crate::types::FrontMatter {
            half_title: true,
            dedication: "For M.".into(),
            contents: true,
            ..Default::default()
        },
        back_matter: crate::types::BackMatter {
            about_the_author: "A. Writer lives by the sea.".into(),
            ..Default::default()
        },
        publishing: crate::types::PublishingTarget {
            service: crate::types::PublishingService::Kdp,
            paper: crate::types::PaperStock::Cream,
        },
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
                page: Some(crate::types::PageOptions {
                    position: crate::types::PagePosition::Sunk,
                    ..Default::default()
                }),
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
        digital: crate::types::DigitalOptions {
            drop_caps: false,
            ..Default::default()
        },
        notes: crate::types::NotesOptions {
            placement: crate::types::NotePlacement::Chapter,
            ..Default::default()
        },
        editions: vec![crate::types::Edition {
            id: "e1".into(),
            name: "Large Print".into(),
            kind: crate::types::EditionKind::LargePrint,
            page_setup: None,
            cover_set_id: Some("v1".into()),
        }],
        active_edition: Some("e1".into()),
        text_styles: vec![crate::types::TextStyleLook {
            id: "sign".into(),
            name: "Sign".into(),
            small_caps: true,
            boxed: true,
            align: crate::types::TextStyleAlign::Center,
            ..Default::default()
        }],
    }
}

pub(super) fn anchor() -> TextAnchor {
    TextAnchor::new(4, 17, "she hesitated")
}

/// One of each command, so that adding a variant means deciding its wire name here.
pub(super) fn every_command() -> Vec<NativeCommand> {
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
            edits: vec![RangeEdit {
                anchor: anchor(),
                text: "she paused".into(),
            }],
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
        NativeCommand::TimelineCommand(TimelineCommandRequest {
            surface_id: "timeline-surface-0".into(),
            command: "scale".into(),
            detail: Some(json!({ "value": "manuscript" })),
        }),
        NativeCommand::AttachTimelineEvent(AttachTimelineEventCommand {
            target: EditorTarget::Primary,
            anchor: anchor(),
            event_id: None,
            title: Some("The siege".into()),
        }),
        NativeCommand::JumpToTimelinePassage(JumpToTimelinePassageCommand {
            doc_path: "chapters/one.md".into(),
            event_id: "e1".into(),
            range_id: None,
        }),
        NativeCommand::RevealTimelineEvent(RevealTimelineEventCommand {
            event_id: "e1".into(),
        }),
        NativeCommand::SetTimeLens(SetTimeLensCommand {
            on: Some(true),
            editing: None,
        }),
        NativeCommand::SetTimelineRangeEditing(SetTimelineRangeEditingCommand { on: true }),
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
        NativeCommand::DuplicateEntry(DuplicateEntryCommand {
            path: "Part One/Chapter 1".into(),
        }),
        NativeCommand::UpdateNote(UpdateNoteCommand {
            doc_path: "one".into(),
            note_id: "n1".into(),
            patch: NotePatch {
                pinned: Some(true),
                ..Default::default()
            },
        }),
        NativeCommand::RemoveNote(NoteRef {
            doc_path: "one".into(),
            note_id: "n1".into(),
        }),
        NativeCommand::JumpToNote(NoteRef {
            doc_path: "one".into(),
            note_id: "n1".into(),
        }),
        NativeCommand::ClipboardDrop(ClipboardDropCommand {
            text: "moved".into(),
        }),
        NativeCommand::RemoveClipboardEntries(RemoveClipboardEntriesCommand { ids: None }),
        NativeCommand::InsertClipboardEntry(InsertClipboardEntryCommand {
            id: "c1".into(),
            target: EditorTarget::Primary,
        }),
        NativeCommand::RemoveTiles(RemoveTilesCommand {
            ids: Some(vec!["t1".into()]),
        }),
        NativeCommand::ReplaceTileWord(ReplaceTileWordCommand {
            id: "t1".into(),
            word: "paused".into(),
        }),
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
        NativeCommand::AddReply(AddReplyCommand {
            doc_path: "one".into(),
            parent_note_id: "n1".into(),
        }),
        NativeCommand::OpenProject(OpenProjectCommand {
            project_name: "Novel".into(),
        }),
        NativeCommand::SetBlockType(SetBlockTypeCommand {
            target: EditorTarget::Primary,
            block: BlockType::Heading1,
        }),
        NativeCommand::SetBlockType(SetBlockTypeCommand {
            target: EditorTarget::Primary,
            block: BlockType::SceneHeading,
        }),
        NativeCommand::SetWritingFormat(SetWritingFormatCommand {
            target: EditorTarget::Primary,
            format: WritingFormat::Screenplay,
        }),
        NativeCommand::ToggleList(ToggleListCommand {
            target: EditorTarget::Primary,
            list: ListKind::Ordered,
        }),
        NativeCommand::EditorHistory(EditorHistoryCommand {
            target: EditorTarget::Primary,
            action: HistoryAction::Undo,
        }),
        NativeCommand::SetFocusMode(SetFocusModeCommand { open: true }),
        NativeCommand::SetWordCountVisible(SetWordCountVisibleCommand { visible: false }),
        NativeCommand::AddReference(AddReferenceCommand {
            id: "r1".into(),
            doc_path: Some("a".into()),
            input: "10.1038/nature14539".into(),
            cite: false,
        }),
        NativeCommand::CreateReference(CreateReferenceCommand {
            id: "r2".into(),
            doc_path: None,
            kind: "book".into(),
        }),
        NativeCommand::UpdateReference(UpdateReferenceCommand {
            id: "r1".into(),
            patch: ReferencePatch {
                note: Some("check p. 4".into()),
                ..Default::default()
            },
        }),
        NativeCommand::DeleteReference(ReferenceRef { id: "r1".into() }),
        NativeCommand::RetryReferenceLookup(ReferenceRef { id: "r1".into() }),
        NativeCommand::ChooseReferenceCandidate(ChooseReferenceCandidateCommand {
            id: "r1".into(),
            index: 2,
        }),
        NativeCommand::SetReferenceAttached(SetReferenceAttachedCommand {
            doc_path: "a".into(),
            id: "r1".into(),
            attached: true,
        }),
        NativeCommand::InsertCitation(InsertCitationCommand {
            target: None,
            ref_ids: vec!["r1".into()],
            locator: Some("42".into()),
        }),
        NativeCommand::InsertBibliography(InsertBibliographyCommand {
            target: Some(EditorTarget::Primary),
        }),
        NativeCommand::SetCitationStyle(SetCitationStyleCommand {
            doc_path: Some("a".into()),
            style: "mla".into(),
            make_project_default: false,
        }),
        NativeCommand::SetBibliographyOptions(SetBibliographyOptionsCommand {
            doc_path: "a".into(),
            options: bibliography_options(),
        }),
        NativeCommand::SetEditorMode(SetEditorModeCommand {
            mode: EditorMode::Typeset,
        }),
        NativeCommand::MoveBookItem(MoveBookItemCommand {
            id: "c:Novel/One".into(),
            before: Some("d1".into()),
            ids: vec!["c:Novel/One".into(), "c:Novel/Three".into()],
        }),
        NativeCommand::SetBookItemHidden(SetBookItemHiddenCommand {
            id: "c:Novel/One".into(),
            hidden: true,
            ids: Vec::new(),
        }),
        NativeCommand::AddBookItem(AddBookItemCommand {
            matter: Some(crate::types::MatterKind::AboutAuthor),
            generated: None,
            part: false,
            before: None,
            title: None,
            back: false,
        }),
        NativeCommand::RemoveBookItem(RemoveBookItemCommand {
            id: "d1".into(),
            ids: vec!["d1".into(), "p:2".into()],
        }),
        NativeCommand::EditBookItem(EditBookItemCommand {
            id: "c:Novel/One".into(),
            title: None,
            chapter_type: Some(crate::types::ChapterType::Prologue),
            page: None,
        }),
        NativeCommand::OpenBookItem(OpenBookItemCommand { id: "d1".into() }),
        NativeCommand::ApplyBookStyle(ApplyBookStyleCommand {
            id: "classic".into(),
        }),
        NativeCommand::SetChapterMeta(SetChapterMetaCommand {
            meta: crate::types::ChapterMeta {
                subtitle: "In which it rains".into(),
                ..Default::default()
            },
        }),
        NativeCommand::SetHeadImage(SetHeadImageCommand {
            target: HeadImageTarget::Ornament,
            path: Some("/Users/a/fleuron.png".into()),
        }),
        NativeCommand::SetFolderBookOptions(SetFolderBookOptionsCommand {
            folder: "Novel".into(),
            number_in_tree: Some(true),
            start_at: Some(0),
            continuous: None,
        }),
        NativeCommand::SetTypesetView(SetTypesetViewCommand {
            view: TypesetView::Digital,
        }),
        NativeCommand::SetParagraphTypeset(SetParagraphTypesetCommand {
            anchor: Some(anchor()),
            nudge_tracking: Some(-5),
            ..Default::default()
        }),
        NativeCommand::ShowProofIssue(ShowProofIssueCommand { anchor: anchor() }),
        NativeCommand::SetTypesetDisplay(SetTypesetDisplayCommand {
            spread: Some(true),
            ..Default::default()
        }),
        NativeCommand::AddProjectFont(AddProjectFontCommand {
            path: "/Users/a/Fonts/Garamond.otf".into(),
        }),
        NativeCommand::SetTextStyle(SetTextStyleCommand {
            style: Some("letter".into()),
        }),
        NativeCommand::InsertFootnote(InsertFootnoteCommand {
            target: EditorTarget::Primary,
        }),
        NativeCommand::EditEditions(EditEditionsCommand {
            action: EditionAction::Add,
            id: None,
            name: None,
            kind: Some(crate::types::EditionKind::LargePrint),
            cover_set_id: None,
        }),
        NativeCommand::ExportAllEditions(ExportAllEditionsCommand {}),
        NativeCommand::SetCoverImage(SetCoverImageCommand {
            set_id: None,
            part: crate::types::CoverPart::Spine,
            path: Some("/Users/a/spine.png".into()),
        }),
        NativeCommand::EditCoverSets(EditCoverSetsCommand {
            action: CoverSetAction::Rename,
            id: Some("v1".into()),
            name: Some("Hardcover".into()),
            fit: None,
        }),
        NativeCommand::SaveTypesetVersion(SaveTypesetVersionCommand {
            name: "Sent to KDP".into(),
        }),
        NativeCommand::RestoreTypesetVersion(TypesetVersionRef { id: "v1".into() }),
        NativeCommand::RenameTypesetVersion(RenameTypesetVersionCommand {
            id: "v1".into(),
            name: "Proof 2".into(),
        }),
        NativeCommand::DeleteTypesetVersion(TypesetVersionRef { id: "v1".into() }),
        NativeCommand::PreviewTypesetVersion(PreviewTypesetVersionCommand {
            id: Some("v1".into()),
            compare: true,
        }),
        NativeCommand::SetPrintLayout(SetPrintLayoutCommand {
            enabled: true,
            doc_path: Some("a.md".into()),
        }),
        NativeCommand::SetPageSetup(SetPageSetupCommand {
            setup: page_setup(),
            target: PageSetupTarget::Book,
        }),
        NativeCommand::SetBookSettings(SetBookSettingsCommand { settings: book() }),
        NativeCommand::SetPrintZoom(SetPrintZoomCommand {
            zoom: Some(1.25),
            fit: None,
            doc_path: None,
        }),
        NativeCommand::SetDisplayDensity(SetDisplayDensityCommand {
            points_per_inch: 127.0,
        }),
        NativeCommand::InsertBreak(InsertBreakCommand {
            target: EditorTarget::Primary,
            kind: PageBreakKind::Recto,
        }),
        NativeCommand::GoToPage(GoToPageCommand { page: 12 }),
        NativeCommand::PrintDocument(PrintDocumentCommand {
            scope: PrintScope::Folder,
            bound: true,
            options: PrintOptions::default(),
        }),
        NativeCommand::PrintDocument(PrintDocumentCommand {
            scope: PrintScope::Document,
            bound: false,
            options: PrintOptions {
                range: PrintRange::CurrentChapter,
                pages: "3-7, 10".into(),
                watermark: "DRAFT".into(),
                recipients: vec![],
                scenes: vec![],
                highlight_character: "MARY".into(),
            },
        }),
        NativeCommand::ExportDocument(ExportDocumentCommand {
            format: ExportFormat::Epub,
            scope: PrintScope::Project,
            bound: false,
            options: PrintOptions::default(),
        }),
        NativeCommand::ExportDocument(ExportDocumentCommand {
            format: ExportFormat::Docx,
            scope: PrintScope::Folder,
            bound: false,
            options: PrintOptions::default(),
        }),
        NativeCommand::ApplyFormat(ApplyFormatCommand {
            format_id: "manuscript".into(),
            target: PageSetupTarget::Document,
        }),
        NativeCommand::UseSetupForBook(UseSetupForBookCommand {}),
        NativeCommand::ClearBookSetup(ClearBookSetupCommand {}),
        NativeCommand::RefreshBookChapters(RefreshBookChaptersCommand {}),
        NativeCommand::SetPrintScope(SetPrintScopeCommand {
            scope: PrintScope::Project,
        }),
        NativeCommand::SetAuthorProfile(SetAuthorProfileCommand {
            profile: crate::types::AuthorProfile {
                byline: "A. Writer".into(),
                email: "a@example.com".into(),
                ..Default::default()
            },
        }),
        NativeCommand::SetBookCover(SetBookCoverCommand {
            path: Some("/Users/a/cover.jpg".into()),
        }),
        NativeCommand::ExportAgain(ExportAgainCommand {}),
        NativeCommand::SelectTab(TabRef {
            tab_id: "tab-1".into(),
        }),
        NativeCommand::CloseTab(TabRef {
            tab_id: "tab-1".into(),
        }),
        NativeCommand::SetTabOrder(SetTabOrderCommand {
            tab_ids: vec!["tab-2".into(), "tab-1".into()],
        }),
        NativeCommand::NewTab(NewTabCommand {}),
        NativeCommand::OpenDocInTab(OpenDocInTabCommand {
            doc_path: "Act One/Scene".into(),
        }),
        NativeCommand::OpenDocInWindow(OpenDocInWindowCommand {
            doc_path: "Act One/Scene".into(),
            at: None,
        }),
        NativeCommand::OpenInSplit(OpenInSplitCommand {
            doc_path: Some("Notes".into()),
            orientation: SplitOrientation::Columns,
        }),
        NativeCommand::CloseSplit(CloseSplitCommand {}),
        NativeCommand::MeasureBook(MeasureBookCommand {}),
        NativeCommand::ImportScript(ImportScriptCommand {}),
        NativeCommand::SetSceneNumbers(SetSceneNumbersCommand {
            mode: SceneNumbering::Locked,
        }),
        NativeCommand::ScriptReport(ScriptReportCommand {
            report: ScriptReportKind::Scenes,
            output: ReportOutput::Csv,
        }),
    ]
}

pub(super) fn bibliography_options() -> BibliographyOptions {
    BibliographyOptions {
        include: BibliographyInclude::Cited,
        annotated: true,
        in_print: true,
        title: None,
    }
}

pub(super) fn a_reference() -> Reference {
    Reference {
        id: "r1".into(),
        kind: "journalArticle".into(),
        contributors: vec![
            Contributor {
                role: "author".into(),
                family: Some("LeCun".into()),
                given: Some("Yann".into()),
                literal: None,
            },
            Contributor {
                role: "author".into(),
                family: None,
                given: None,
                literal: Some("NASA".into()),
            },
        ],
        fields: [
            ("title".to_string(), "Deep learning".to_string()),
            ("issued".to_string(), "2015-05-28".to_string()),
        ]
        .into_iter()
        .collect(),
        annotation: "".into(),
        note: "".into(),
        tags: vec![],
        status: ReferenceStatus::Complete,
        origin: Some(ReferenceOrigin {
            kind: "doi".into(),
            input: "10.1038/nature14539".into(),
        }),
        candidates: vec![],
        error: None,
        created_at: "2026-09-23T12:00:00.000Z".into(),
        updated_at: "2026-09-23T12:00:00.000Z".into(),
    }
}

pub(super) fn bubble_session() -> BubbleSession {
    BubbleSession {
        id: "b1".into(),
        words: vec![
            BubbleWord {
                id: "w1".into(),
                text: "She".into(),
            },
            BubbleWord {
                id: "w2".into(),
                text: "hesitated at the door".into(),
            },
        ],
        aside: vec![BubbleAside {
            id: "w3".into(),
            text: "quietly".into(),
            x: 0.02,
            y: 0.5,
        }],
        original: "She quietly hesitated at the door".into(),
        mode: Some(BubbleMode::Clauses),
        forms: vec![BubbleForm {
            id: "f1".into(),
            words: vec![BubbleWord {
                id: "w2".into(),
                text: "hesitated at the door".into(),
            }],
            aside: vec![],
            mode: None,
        }],
        unsaved: None,
    }
}

pub(super) fn archived_bubble() -> ArchivedItem {
    ArchivedItem {
        id: "x1".into(),
        archived_at: "2026-09-23T12:00:00.000Z".into(),
        kind: ArchivedKind::Bubble,
        title: "She hesitated at the door".into(),
        bubble: Some(bubble_session()),
    }
}

pub(super) fn map_button(id: &str, label: &str) -> MapPanelButton {
    MapPanelButton {
        id: id.into(),
        label: label.into(),
        role: MapButtonRole::Normal,
        disabled: false,
        icon: None,
        help: None,
    }
}

/// A map's chrome with one of every kind of field, so each is on the wire at least once.
pub(super) fn map_chrome() -> MapChromeState {
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
            options: vec![MapChoice {
                value: "solid".into(),
                label: "Solid".into(),
                group: None,
            }],
            help: None,
        }),
        MapPanelField::Toggle(MapToggleInput {
            id: "route.arrow".into(),
            label: "Arrow at end".into(),
            value: false,
        }),
        MapPanelField::Color(MapColorInput {
            id: "pin.color".into(),
            label: "Colour".into(),
            value: None,
            fallback: "#c0392b".into(),
        }),
        MapPanelField::Stat(MapStatRow {
            label: "Length".into(),
            value: "42 km".into(),
            action: None,
        }),
        MapPanelField::Note(MapNoteText {
            text: "Tip".into(),
            tone: MapNoteTone::Warning,
            swatch: None,
            action: None,
        }),
        MapPanelField::Button(map_button("pin.open", "Open")),
        MapPanelField::Buttons(MapButtonRow {
            buttons: vec![map_button("theme.clean", "Clean")],
        }),
        MapPanelField::ListRow(MapListRow {
            id: "places.p1".into(),
            title: "Harrowgate".into(),
            subtitle: None,
            swatch: None,
            indent: 0,
        }),
        MapPanelField::Markers(MapMarkerInput {
            id: "pin.icon".into(),
            value: "city".into(),
            color: None,
            options: vec![MapChoice {
                value: "city".into(),
                label: "City".into(),
                group: None,
            }],
        }),
        MapPanelField::Date(MapDateInput {
            id: "traveler.startDay".into(),
            label: "On".into(),
            value: Some(MapDateParts {
                year: 1850.0,
                month: 3.0,
                day: 1.0,
                hour: 9.0,
                minute: 30.0,
            }),
            mode: MapCalendarMode::Gregorian,
            months: vec!["January".into()],
            allow_empty: false,
            placeholder: None,
        }),
        MapPanelField::Table(MapTableView {
            columns: vec!["Harrowgate".into()],
            rows: vec![MapTableRowView {
                label: "Harrowgate".into(),
                cells: vec![MapTableCell {
                    text: "—".into(),
                    detail: None,
                    strong: false,
                }],
            }],
        }),
        MapPanelField::Preview(MapShapePreview {
            width: 100.0,
            height: 50.0,
            path: "M0 0L10 10Z".into(),
            filled: true,
        }),
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
            sections: vec![MapPanelSection {
                id: "place".into(),
                title: "Place".into(),
                actions: vec![],
                fields,
            }],
        },
        reveal_panel: 1,
        active: true,
        map_kind: Some(crate::types::map::MapKind::Earth),
        view_menu: vec![MapMenuItem {
            id: "earth.view.globe".into(),
            label: "Globe".into(),
            checked: true,
            disabled: false,
            separator: false,
        }],
    }
}

pub(super) fn every_event() -> Vec<WebviewEvent> {
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
        WebviewEvent::MapChromeChanged(MapChromeChanged {
            state: Some(map_chrome()),
        }),
        WebviewEvent::TimelineChromeChanged(TimelineChromeChanged {
            state: Some(TimelineChromeState {
                surface_id: "timeline-surface-0".into(),
                doc_path: "Plot/Main.timeline".into(),
                scale: crate::types::TimelineScale::Manuscript,
                can_undo: true,
                can_redo: false,
                has_selection: true,
                lens_on: false,
                panel: map_chrome().panel,
                reveal_panel: 1,
                active: true,
                inspector_open: true,
            }),
        }),
        WebviewEvent::TimelineCursorChanged(TimelineCursorChanged {
            lens_on: true,
            lens_editing: false,
            editing_ranges: false,
        }),
        WebviewEvent::TimelineRangesChanged(TimelineRangesChanged {
            doc_path: "chapters/one.md".into(),
            ranges: vec![crate::types::TimelineRange {
                id: "r1".into(),
                event_id: "e1".into(),
                from: 3,
                to: 12,
                anchor: "hesitated".into(),
            }],
        }),
        WebviewEvent::ReadAloudPayload(ReadAloudPayloadEvent {
            doc_path: "chapters/one.md".into(),
            payload: Default::default(),
        }),
        WebviewEvent::ProjectChanged(ProjectChanged {
            project_name: Some("Novel".into()),
            project_root: Some("/Users/me/Novel".into()),
        }),
        WebviewEvent::ShowSidebarTab(ShowSidebarTab {
            tab: SidebarTab::History,
        }),
        WebviewEvent::ViewOptions(ViewOptions {
            focus_mode: false,
            word_count_visible: true,
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
                icon: "book-closed".into(),
                fields: vec![ReferenceFieldSpec {
                    key: "title".into(),
                    label: "Title".into(),
                    placeholder: "".into(),
                    input: ReferenceFieldInput::Text,
                    required: true,
                }],
                roles: vec!["author".into()],
            }],
            roles: vec![ContributorRoleSpec {
                id: "author".into(),
                label: "Author".into(),
            }],
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
            spread: false,
            show_grid: true,
            proof: true,
            proof_issues: vec![ProofIssue {
                id: "widow-12".into(),
                kind: ProofKind::Widow,
                page: 3,
                anchor: TextAnchor::new(120, 136, "and so it ended."),
                fixes: vec![ProofFix::Tighten, ProofFix::RunLong],
            }],
            paragraph: Some(ParagraphTypeset {
                tracking: -5,
                ..Default::default()
            }),
            project_fonts: vec![ProjectFont {
                family: "EB Garamond".into(),
                path: ".assets/fonts/EBGaramond.otf".into(),
                embeddable: true,
            }],
            text_styles: vec![crate::types::TextStyleLook {
                id: "letter".into(),
                name: "Letter".into(),
                indent_em: 2.0,
                flush: true,
                space_lines: 1.0,
                ..Default::default()
            }],
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
            chapter_meta: Some(crate::types::ChapterMeta {
                subtitle: "In which it rains".into(),
                ..Default::default()
            }),
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
            author: crate::types::AuthorProfile {
                byline: "A. Writer".into(),
                ..Default::default()
            },
            word_count: 71_400,
            cover_file: Some("/Users/a/Novel/.assets/ab12.jpg".into()),
            last_export: Some(LastExport {
                format: ExportFormat::Docx,
                scope: PrintScope::Folder,
                path: "/Users/a/Book.docx".into(),
            }),
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
                scenes: vec![SceneSummary {
                    number: Some("12A".into()),
                    heading: "INT. KITCHEN - NIGHT".into(),
                    page: 14,
                }],
            }),
        }),
        WebviewEvent::PageLayoutCatalog(PageLayoutCatalog {
            presets: vec![PageSizeOption {
                id: "a4".into(),
                label: "A4".into(),
                group: "ISO A".into(),
                width_mm: 210.0,
                height_mm: 297.0,
            }],
            formats: vec![FormatOption {
                id: "manuscript".into(),
                label: "Standard Manuscript".into(),
                group: "Submission".into(),
                summary: "What agents and editors ask for.".into(),
                kind: FormatKind::Prose,
            }],
            signature_advice: vec![SignatureAdvice {
                sheets: 4,
                label: "Standard".into(),
            }],
            tokens: vec![RunningToken {
                token: "{page}".into(),
                label: "Page Number".into(),
            }],
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
        WebviewEvent::TypesetFocus(TypesetFocus {
            section_id: "page.size".into(),
        }),
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
                DocTab {
                    id: "tab-1".into(),
                    doc_path: Some("Act One/Scene".into()),
                    secondary_doc: Some("Notes".into()),
                    split: Some(SplitOrientation::Rows),
                },
                DocTab {
                    id: "tab-2".into(),
                    doc_path: None,
                    secondary_doc: None,
                    split: None,
                },
            ],
            active_tab_id: Some("tab-1".into()),
        }),
    ]
}
