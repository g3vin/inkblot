//! The Book: its rows (chapters, front and back matter) and the commands that
//! reorder, hide, add, edit and open them.

use super::*;

/// Where in the book an entry is: before the first chapter, among them, or after.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BookRowSection {
    Front,
    Body,
    Back,
}

/// One entry of a book as the navigator draws it: a `BookItem` with what the page
/// worked out about it — its number, its label, which part it is in.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookRow {
    pub id: String,
    pub kind: BookItemKind,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    pub hidden: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub matter: Option<MatterKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub generated: Option<GeneratedKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chapter_type: Option<ChapterType>,
    /// A numbered chapter's number, or a part's.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub number: Option<u32>,
    /// "Chapter One", "Prologue", "Part II" — what its head says.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub section: BookRowSection,
    /// The part it is in, by id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub part: Option<String>,
    /// Its page options, its own over its kind's.
    pub page: PageOptions,
    /// Printed from text from before matter pages were documents; opening it makes it one.
    #[serde(default)]
    pub legacy: bool,
}

/// Move an entry to before another (or to the end, with none). Only the book's order
/// changes — never the file tree.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveBookItemCommand {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub before: Option<String>,
    /// A selection moved as one block, in the book's order (`id` among them). Empty
    /// moves `id` alone.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub ids: Vec<String>,
}

/// Hide an entry from the Typeset pages, print, export and the continuous document, or
/// show it again.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetBookItemHiddenCommand {
    pub id: String,
    pub hidden: bool,
    /// A selection hidden or shown together (`id` among them). Empty changes `id` alone.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub ids: Vec<String>,
}

/// Add a page of front or back matter (a document, made from its kind's template), a
/// page the book lays out itself, or a part divider — where the standard order has it.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddBookItemCommand {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub matter: Option<MatterKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub generated: Option<GeneratedKind>,
    /// A part divider, before the entry `before` (or at the end of the chapters).
    #[serde(default)]
    pub part: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub before: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// For a kind that can go either side (Also By): the back.
    #[serde(default)]
    pub back: bool,
}

/// Take a matter page, a generated page or a part out of the book. A matter page's
/// document is deleted with it (the navigator asks first). A chapter cannot be removed
/// here — only hidden: it is the manuscript's.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveBookItemCommand {
    pub id: String,
    /// A selection removed together (`id` among them); its chapters are skipped. Empty
    /// removes `id` alone.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub ids: Vec<String>,
}

/// Rename an entry, change what kind of chapter it is, or how its page sits. Each field
/// present is set; absent ones are left as they are.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditBookItemCommand {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chapter_type: Option<ChapterType>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page: Option<PageOptions>,
}

/// Select an entry: open its document, or show its page, and make it This Page.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenBookItemCommand {
    pub id: String,
}

/// Something on a Typeset page was picked — a margin, a running head, a chapter's
/// number — and the inspector should show where it is set: the Typeset tab, with that
/// section open (`FinishingSectionID`).
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TypesetFocus {
    pub section_id: String,
}

/// A folder's book options, from the file tree's menu: numbering its documents in the
/// tree, where they count from, and scrolling from one into the next. Each field present
/// is set; the rest of the folder's book is left as it is.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetFolderBookOptionsCommand {
    pub folder: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub number_in_tree: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_at: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub continuous: Option<bool>,
}

/* ---------------- covers ---------------- */
