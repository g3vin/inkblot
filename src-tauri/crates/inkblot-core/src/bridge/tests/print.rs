//! Print Layout on the wire: page setup in millimetres, typography, books saved by
//! older builds, print options, and commands from older shells.

use super::*;

#[test]
fn a_page_setup_crosses_the_wire_in_millimetres_and_camel_case() {
    let command = NativeCommand::SetPageSetup(SetPageSetupCommand {
        setup: page_setup(),
        target: PageSetupTarget::Document,
    });
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
fn a_book_entry_command_from_an_older_shell_acts_on_its_one_entry() {
    let wire = json!({ "type": "setBookItemHidden", "payload": { "id": "d1", "hidden": true } });
    let command: NativeCommand = serde_json::from_value(wire).unwrap();
    match &command {
        NativeCommand::SetBookItemHidden(edit) => assert!(edit.ids.is_empty()),
        other => panic!("read as {other:?}"),
    }
    let text = serde_json::to_string(&command).unwrap();
    assert!(
        !text.contains("ids"),
        "an empty selection is left off the wire: {text}"
    );
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
    use crate::types::{
        ChapterOpening, LineSpacing, PrintAlignment, PrintTypography, TitlePageOptions,
        TitlePageStyle,
    };
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
        composition: None,
        features: None,
    });
    setup.title_page = Some(TitlePageOptions {
        style: TitlePageStyle::Manuscript,
        show_contact: true,
        show_word_count: true,
    });
    let wire = serde_json::to_value(&setup).unwrap();
    assert_eq!(wire["typography"]["lineSpacing"], "double");
    assert_eq!(wire["typography"]["chapterOpening"], "dropCapAndSmallCaps");
    assert_eq!(wire["titlePage"]["style"], "manuscript");
    round_trip(&setup);
}

#[test]
fn a_script_element_is_a_block_type_and_an_old_toolbar_is_prose() {
    assert_eq!(
        serde_json::to_value(BlockType::StageDirection).unwrap(),
        "stageDirection"
    );
    assert_eq!(
        serde_json::to_value(WritingFormat::Stageplay).unwrap(),
        "stageplay"
    );
    let mut toolbar = serde_json::to_value(
        every_event()
            .into_iter()
            .find_map(|e| match e {
                WebviewEvent::ToolbarState(state) => Some(state),
                _ => None,
            })
            .unwrap(),
    )
    .unwrap();
    toolbar.as_object_mut().unwrap().remove("writingFormat");
    let read: ToolbarState = serde_json::from_value(toolbar).unwrap();
    assert_eq!(read.writing_format, WritingFormat::Prose);
}

#[test]
fn a_print_from_an_older_shell_has_no_options() {
    let old: PrintDocumentCommand =
        serde_json::from_value(json!({ "scope": "document", "bound": false })).unwrap();
    assert_eq!(old.options, PrintOptions::default());
    let wire = serde_json::to_value(ExportFormat::PlainText).unwrap();
    assert_eq!(wire, "plainText");
    assert_eq!(
        serde_json::to_value(ExportFormat::Fountain).unwrap(),
        "fountain"
    );
    assert_eq!(serde_json::to_value(ExportFormat::Fdx).unwrap(), "fdx");
    let partial: PrintOptions = serde_json::from_value(json!({ "watermark": "DRAFT" })).unwrap();
    assert_eq!(partial.range, PrintRange::All);
    assert!(partial.pages.is_empty());
    assert!(partial.scenes.is_empty() && partial.highlight_character.is_empty());
    let sides: PrintOptions = serde_json::from_value(
        json!({ "range": "scenes", "scenes": [2, 5], "highlightCharacter": "MARY" }),
    )
    .unwrap();
    assert_eq!(
        (
            sides.range,
            sides.scenes,
            sides.highlight_character.as_str()
        ),
        (PrintRange::Scenes, vec![2, 5], "MARY")
    );
}

#[test]
fn a_book_saved_before_compiling_reads_with_everything_in() {
    let mut old = serde_json::to_value(book()).unwrap();
    for key in ["excluded", "chapterNumbering", "frontMatter", "backMatter"] {
        old.as_object_mut().unwrap().remove(key);
    }
    let read: crate::types::BookSettings = serde_json::from_value(old).unwrap();
    assert!(read.excluded.is_empty());
    assert_eq!(
        read.chapter_numbering.style,
        crate::types::ChapterNumberStyle::None
    );
    assert!(!read.front_matter.contents);
    let wire = serde_json::to_value(book()).unwrap();
    assert_eq!(wire["chapterNumbering"]["style"], "words");
    assert_eq!(wire["frontMatter"]["halfTitle"], true);
    assert_eq!(
        wire["backMatter"]["aboutTheAuthor"],
        "A. Writer lives by the sea."
    );
}

#[test]
fn a_book_saved_before_typesetting_reads_with_no_design_contents_or_covers() {
    let mut old = serde_json::to_value(book()).unwrap();
    for key in [
        "chapterDesign",
        "partDesign",
        "items",
        "continuous",
        "covers",
        "activeCover",
    ] {
        old.as_object_mut().unwrap().remove(key);
    }
    old["chapterNumbering"]
        .as_object_mut()
        .unwrap()
        .remove("startAt");
    old["chapterNumbering"]
        .as_object_mut()
        .unwrap()
        .remove("showInTree");
    let read: crate::types::BookSettings = serde_json::from_value(old).unwrap();
    assert!(read.chapter_design.is_none() && read.items.is_empty() && read.covers.is_empty());
    assert!(!read.continuous);
    assert_eq!(
        read.chapter_numbering.start_at, 1,
        "an old book counts from one"
    );
    assert!(!read.chapter_numbering.show_in_tree);

    let wire = serde_json::to_value(book()).unwrap();
    assert_eq!(wire["chapterDesign"]["chapterBreak"], "newRightPage");
    assert_eq!(wire["chapterDesign"]["ornament"], "glyph");
    assert_eq!(wire["items"][0]["matter"], "dedication");
    assert_eq!(wire["items"][0]["page"]["position"], "sunk");
    assert_eq!(wire["items"][1]["chapterType"], "prologue");
    assert_eq!(wire["covers"][0]["madeForSpineMm"], 12.4);
    let design: crate::types::ChapterDesign =
        serde_json::from_value(json!({ "showNumber": true })).unwrap();
    assert!(
        design.show_title && design.show_number,
        "a partial design fills the rest in"
    );
    assert_eq!(design.chapter_break, crate::types::ChapterBreak::NewPage);
}

#[test]
fn an_author_profile_missing_fields_reads_as_blank() {
    let profile: crate::types::AuthorProfile =
        serde_json::from_value(json!({ "byline": "A. Writer" })).unwrap();
    assert_eq!(profile.byline, "A. Writer");
    assert!(profile.email.is_empty());
}
