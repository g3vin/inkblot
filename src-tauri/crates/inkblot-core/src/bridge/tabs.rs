//! Document tabs and split view, for a shell that draws the tab bar natively.
//!
//! The rule is the sidebar's (see `sidebar.rs`): the page owns the state and publishes
//! it whole, and the shell changes it by command. Tabs are `useTabs`'s, and a tab's
//! document is opened by the page's own loader, so a shell that kept its own list would
//! be a second list to disagree with.
//!
//! The Swift app draws the tabs over the page column, as Xcode's editor tabs are
//! (`DocumentTabBar`). A tab owns its split, as a Safari or Xcode tab does: its
//! document, and optionally a second one beside or below it, which comes back when
//! the tab is selected again.
//!
//! Opening a particular document in the split's pane is `openDocument` with
//! `Pane::Secondary`; `OpenInSplitCommand` is for opening the split itself.

use serde::{Deserialize, Serialize};
use typeshare::typeshare;

/// One open tab: a document, or a draft that has not decided what it is yet, and the
/// split it shows.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocTab {
    pub id: String,
    /// `None` for a draft.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub doc_path: Option<String>,
    /// The split's document, while this tab has a split.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secondary_doc: Option<String>,
    /// How the split is laid out, while this tab has one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub split: Option<SplitOrientation>,
}

/// How a split lays its two panes out.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SplitOrientation {
    /// Side by side.
    Columns,
    /// One above the other.
    Rows,
}

/// The tabs, in order, and which is showing. Sent whole whenever any of it changes,
/// so it is coalesced to one per frame.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabsChanged {
    pub tabs: Vec<DocTab>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_tab_id: Option<String>,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabRef {
    pub tab_id: String,
}

/// The tabs' order, as the shell's tab bar now shows it after a drag. Tabs it does not
/// name keep their order after the ones it does.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetTabOrderCommand {
    pub tab_ids: Vec<String>,
}

/// Open a draft tab, where the page asks what the new document is called.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewTabCommand {}

/// Open a document in a tab of its own, and show it.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenDocInTabCommand {
    pub doc_path: String,
}

/// Open a document in a detached window of its own (a tab's Move to New Window). The
/// page opens it as "Open in New Window" does.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenDocInWindowCommand {
    pub doc_path: String,
}

/// Open the active tab's split, or turn it. Without a `doc_path` the split keeps what
/// it shows, or else takes the next tab's document.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenInSplitCommand {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub doc_path: Option<String>,
    pub orientation: SplitOrientation,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseSplitCommand {}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bridge::{NativeCommand, WebviewEvent};
    use serde_json::json;

    #[test]
    fn a_new_tab_needs_no_payload_but_still_has_one() {
        let command: NativeCommand =
            serde_json::from_value(json!({ "type": "newTab", "payload": {} })).unwrap();
        assert_eq!(command, NativeCommand::NewTab(NewTabCommand::default()));
    }

    #[test]
    fn tabs_cross_in_camel_case_and_a_draft_has_no_path() {
        let event = WebviewEvent::TabsChanged(TabsChanged {
            tabs: vec![
                DocTab { id: "1".into(), doc_path: Some("ch/one".into()), secondary_doc: Some("notes".into()), split: Some(SplitOrientation::Rows) },
                DocTab { id: "2".into(), doc_path: None, secondary_doc: None, split: None },
            ],
            active_tab_id: Some("2".into()),
        });
        let wire = serde_json::to_value(&event).unwrap();
        assert_eq!(wire["type"], "tabsChanged");
        assert_eq!(wire["payload"]["activeTabId"], "2");
        assert_eq!(wire["payload"]["tabs"][0]["docPath"], "ch/one");
        assert!(wire["payload"]["tabs"][1].get("docPath").is_none());
        assert_eq!(wire["payload"]["tabs"][0]["secondaryDoc"], "notes");
        assert_eq!(wire["payload"]["tabs"][0]["split"], "rows");
        assert!(wire["payload"]["tabs"][1].get("split").is_none());
        assert_eq!(serde_json::from_value::<WebviewEvent>(wire).unwrap(), event);
    }

    #[test]
    fn a_split_names_its_orientation_as_the_page_does() {
        // The page's own strings (`splitOrientation` in the session), so it passes
        // them through unmapped.
        let command: NativeCommand = serde_json::from_value(json!({
            "type": "openInSplit",
            "payload": { "orientation": "rows" }
        }))
        .unwrap();
        assert_eq!(
            command,
            NativeCommand::OpenInSplit(OpenInSplitCommand { doc_path: None, orientation: SplitOrientation::Rows })
        );
    }
}
