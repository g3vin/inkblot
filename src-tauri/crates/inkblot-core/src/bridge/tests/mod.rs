//! What these tests are for.
//!
//! The generated TypeScript is checked by `npm run types:check`, which proves both
//! languages describe the same *types*. It does not look at a single byte of JSON. But
//! JSON is what actually crosses the seam, and any other shell would be written
//! against the exact shape below — so the shape is asserted literally here,
//! not derived from the same serde attributes it is meant to be checking.
//!
//! The exhaustive tag tests are the load-bearing ones. Adding a variant without
//! deciding what it looks like on the wire fails them, which is the only moment that
//! decision is cheap to make.

use super::*;
use crate::types::note::Note;
use serde_json::{json, Value};

// Fixtures (one of everything) and the Print Layout tests live in their own files.
mod fixtures;
mod print;

use fixtures::*;

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
    wire["type"]
        .as_str()
        .expect("a string `type` tag")
        .to_string()
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

#[test]
fn a_reference_is_camel_case_and_keeps_csl_field_names() {
    let value = serde_json::to_value(a_reference()).unwrap();
    assert_eq!(value["createdAt"], json!("2026-09-23T12:00:00.000Z"));
    assert_eq!(value["status"], json!("complete"));
    assert_eq!(value["fields"]["title"], json!("Deep learning"));
    assert_eq!(
        value["contributors"][1],
        json!({ "role": "author", "literal": "NASA" })
    );
    let patch = serde_json::to_value(ReferencePatch {
        annotation: Some("x".into()),
        ..Default::default()
    })
    .unwrap();
    assert_eq!(patch, json!({ "annotation": "x" }));
}

#[test]
fn an_archived_item_is_camel_case_and_names_its_kind() {
    let value = serde_json::to_value(archived_bubble()).unwrap();
    assert_eq!(value["archivedAt"], json!("2026-09-23T12:00:00.000Z"));
    assert_eq!(value["kind"], json!("bubble"));
    assert_eq!(value["bubble"]["id"], json!("b1"));
    let bare: ArchivedItem = serde_json::from_value(
        json!({ "id": "x2", "archivedAt": "", "kind": "bubble", "title": "" }),
    )
    .unwrap();
    assert_eq!(bare.bubble, None);
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
            "timelineCommand",
            "attachTimelineEvent",
            "jumpToTimelinePassage",
            "revealTimelineEvent",
            "setTimeLens",
            "setTimelineRangeEditing",
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
            "openProject",
            "setBlockType",
            "setBlockType",
            "setWritingFormat",
            "toggleList",
            "editorHistory",
            "setFocusMode",
            "setWordCountVisible",
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
            "setParagraphTypeset",
            "showProofIssue",
            "setTypesetDisplay",
            "addProjectFont",
            "setTextStyle",
            "insertFootnote",
            "editEditions",
            "exportAllEditions",
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
            "activeEditorChanged",
            "canvasToolbarChanged",
            "mapChromeChanged",
            "timelineChromeChanged",
            "timelineCursorChanged",
            "timelineRangesChanged",
            "readAloudPayload",
            "projectChanged",
            "showSidebarTab",
            "viewOptions",
            "referencesChanged",
            "referenceSchema",
            "revealReference",
            "pageLayoutState",
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
        BridgeRequest::GetToolbarState(EditorQuery {
            target: Some(EditorTarget::Secondary),
        }),
        BridgeRequest::GetReadAloudPayload(ReadAloudQuery {
            target: None,
            selection_only: true,
        }),
        BridgeRequest::GetDocumentText(EditorQuery::default()),
    ];
    let names: Vec<String> = requests.iter().map(tag_of).collect();
    assert_eq!(
        names,
        vec![
            "getSelectionContext",
            "getToolbarState",
            "getReadAloudPayload",
            "getDocumentText"
        ]
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
    assert_eq!(
        value["words"][1],
        json!({ "id": "w2", "text": "hesitated at the door" })
    );
    assert_eq!(
        value["aside"][0],
        json!({ "id": "w3", "text": "quietly", "x": 0.02, "y": 0.5 })
    );
    assert_eq!(value["mode"], json!("clauses"));
    assert_eq!(
        value["forms"][0],
        json!({
            "id": "f1", "words": [{ "id": "w2", "text": "hesitated at the door" }], "aside": [],
        })
    );

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
    let command = NativeCommand::SetBlockType(SetBlockTypeCommand {
        target: EditorTarget::Primary,
        block: BlockType::Heading2,
    });
    assert_eq!(
        serde_json::to_value(&command).unwrap(),
        json!({ "type": "setBlockType", "payload": { "target": "primary", "block": "heading2" } })
    );
    let event = WebviewEvent::ViewOptions(ViewOptions {
        focus_mode: true,
        word_count_visible: false,
    });
    assert_eq!(
        serde_json::to_value(&event).unwrap(),
        json!({ "type": "viewOptions", "payload": { "focusMode": true, "wordCountVisible": false } })
    );
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
    assert_eq!(
        value["panel"]["sections"][0]["fields"][0]["payload"]["focusKey"],
        json!(0)
    );
    // A panel with no tab chosen says nothing about one.
    assert!(value["panel"].get("tab").is_none());
}

#[test]
fn a_tab_dragged_out_says_where_its_window_goes() {
    let dropped: NativeCommand = serde_json::from_value(serde_json::json!({
        "type": "openDocInWindow",
        "payload": { "docPath": "Act One/Scene", "at": { "x": 640, "y": -20 } },
    }))
    .unwrap();
    assert_eq!(
        dropped,
        NativeCommand::OpenDocInWindow(OpenDocInWindowCommand {
            doc_path: "Act One/Scene".into(),
            at: Some(ScreenPoint { x: 640, y: -20 }),
        })
    );
    let menu = serde_json::to_value(NativeCommand::OpenDocInWindow(OpenDocInWindowCommand {
        doc_path: "A".into(),
        at: None,
    }))
    .unwrap();
    assert_eq!(
        menu,
        serde_json::json!({ "type": "openDocInWindow", "payload": { "docPath": "A" } })
    );
}
