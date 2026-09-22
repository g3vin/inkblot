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
    ]
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
            active_marks: ActiveMarks::default(),
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
    ]
}

#[test]
fn every_command_has_the_wire_name_the_handoff_promised() {
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
            "canvasDropDoc",
            "canvasDropNote",
            "canvasReveal",
            "canvasRestore",
        ]
    );
}

#[test]
fn every_event_has_the_wire_name_the_handoff_promised() {
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
            "searchMatches",
            "focusModeView",
            "readAloudPayload",
            "dragStarted",
            "dragMoved",
            "dragEnded",
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
        }),
    });

    let OutboundMessage::Event(envelope) = round_trip(&outbound) else {
        panic!("an event envelope came back as something else");
    };
    assert_eq!(envelope.seq, 41);
}
