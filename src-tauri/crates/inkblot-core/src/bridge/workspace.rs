//! The workspace's half of the protocol: the tab dock, the new-tab chooser, and the
//! sentence-structure bubble, for a shell that draws them natively.
//!
//! The rule is the sidebar's (see `sidebar.rs`): the page owns the state and publishes
//! it, and the shell changes it by command. Tabs are `useTabs`'s, and a tab's document
//! is opened by the page's own loader, so a shell that kept its own list would be a
//! second list to disagree with. A draft becomes a document through `DraftTabPane`'s
//! checks (a name, no `/`, nothing already at that path), which the page runs so the
//! Tauri app and the Swift shell refuse the same names. And the parse behind the bubble
//! is compromise's tagger plus the page's grammar; the shell draws the trees it is sent.

use serde::{Deserialize, Serialize};
use typeshare::typeshare;

use crate::types::geometry::Rect;

/* ---------------- the tab dock ---------------- */

/// One open tab: a document, or a draft that has not decided what it is yet.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocTab {
    pub id: String,
    /// `None` for a draft.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub doc_path: Option<String>,
    /// Opened by a single click and replaced by the next one, until it is edited.
    #[serde(default)]
    pub ephemeral: bool,
}

/// Everything the dock draws. Sent whole whenever any of it changes.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabsChanged {
    pub tabs: Vec<DocTab>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_tab_id: Option<String>,
    /// The documents in the two panes — a tab showing one of these keeps its name
    /// visible in the collapsed dock.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_doc: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secondary_doc: Option<String>,
    pub split: bool,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabRef {
    pub tab_id: String,
}

/// Open a draft tab, as the dock's `+` does. Nothing to say, but adjacent tagging
/// wants a payload, so it is an empty object.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewTabCommand {}

/// Open a document in a tab of its own — a document dropped on the dock.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenDocInTabCommand {
    pub doc_path: String,
}

/* ---------------- the new-tab chooser ---------------- */

#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DraftKind {
    Doc,
    Canvas,
}

/// Where the chooser goes, or that it is gone. The page keeps the pane itself (a draft
/// holds the pane open, and a split stays up around it) and reports its rectangle, in
/// the web view's coordinates, for the shell to draw into.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftPaneChanged {
    /// The draft being shown; `None` when no draft is.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tab_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rect: Option<Rect>,
    /// Why the last attempt was refused ("A document with that name already exists.").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(default)]
    pub creating: bool,
}

/// Make the draft into a document. The page checks the name and makes the file; the
/// answer is the next `DraftPaneChanged` — gone if it worked, with a status if not.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateFromDraftCommand {
    pub tab_id: String,
    pub name: String,
    pub kind: DraftKind,
}

/* ---------------- the sentence-structure bubble ---------------- */

/// A node of a parse: a phrase with children, or a leaf (a part-of-speech tag, or a
/// word) with none.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseNode {
    pub label: String,
    #[serde(default)]
    pub children: Vec<ParseNode>,
}

/// One way the sentence parses, and the grammar's score for it — higher is likelier.
/// Not a probability: the parser mixes products and log-sums, so it is only good for
/// ordering.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentenceParse {
    pub score: f64,
    pub tree: ParseNode,
}

/// "Open Analytic Bubble" was chosen: the sentence, its best parses, and where the
/// right-click was, in the web view's coordinates.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentenceStructure {
    pub sentence: String,
    pub parses: Vec<SentenceParse>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor: Option<Rect>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bridge::{NativeCommand, WebviewEvent};
    use serde_json::json;

    #[test]
    fn a_new_tab_needs_no_payload_but_still_has_one() {
        // Adjacent tagging: the page's client always sends a payload object, and a
        // command with nothing to say must still decode from `{}`.
        let command: NativeCommand =
            serde_json::from_value(json!({ "type": "newTab", "payload": {} })).unwrap();
        assert_eq!(command, NativeCommand::NewTab(NewTabCommand::default()));
    }

    #[test]
    fn tabs_cross_in_camel_case_and_a_draft_has_no_path() {
        let event = WebviewEvent::TabsChanged(TabsChanged {
            tabs: vec![
                DocTab { id: "1".into(), doc_path: Some("ch/one".into()), ephemeral: false },
                DocTab { id: "2".into(), doc_path: None, ephemeral: false },
            ],
            active_tab_id: Some("2".into()),
            current_doc: Some("ch/one".into()),
            secondary_doc: None,
            split: false,
        });
        let wire = serde_json::to_value(&event).unwrap();
        assert_eq!(wire["type"], "tabsChanged");
        assert_eq!(wire["payload"]["activeTabId"], "2");
        assert_eq!(wire["payload"]["tabs"][0]["docPath"], "ch/one");
        assert!(wire["payload"]["tabs"][1].get("docPath").is_none());
        assert_eq!(serde_json::from_value::<WebviewEvent>(wire).unwrap(), event);
    }

    #[test]
    fn a_parse_tree_nests_and_leaves_have_no_children() {
        let wire = json!({
            "sentence": "Dogs bark.",
            "parses": [{
                "score": -1.5,
                "tree": { "label": "S", "children": [
                    { "label": "NP", "children": [{ "label": "Noun" }] },
                    { "label": "VP", "children": [{ "label": "Verb" }] }
                ] }
            }]
        });
        let structure: SentenceStructure = serde_json::from_value(wire).unwrap();
        let tree = &structure.parses[0].tree;
        assert_eq!(tree.children[1].children[0].label, "Verb");
        assert!(tree.children[0].children[0].children.is_empty());
        assert!(structure.anchor.is_none());
    }

    #[test]
    fn a_draft_is_made_by_kind() {
        let command: NativeCommand = serde_json::from_value(json!({
            "type": "createFromDraft",
            "payload": { "tabId": "7", "name": "Act One", "kind": "canvas" }
        }))
        .unwrap();
        assert_eq!(
            command,
            NativeCommand::CreateFromDraft(CreateFromDraftCommand {
                tab_id: "7".into(),
                name: "Act One".into(),
                kind: DraftKind::Canvas,
            })
        );
    }
}
