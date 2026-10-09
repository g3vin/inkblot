//! References: the sources a writer cites, the citations in the text, and the
//! bibliography at the end.
//!
//! The library is the project's (`.inkblot-references.json` at the project root), so a
//! source cited in three chapters is one source, edited once. A document keeps which
//! sources it has attached, its citation style and how its bibliography is built, in
//! its own file (`citations`, beside `archive`). Citations themselves are nodes in the
//! document, naming sources by id — so they survive edits, copy and version restore the
//! way any other text does.
//!
//! The page owns all of it, as it owns the document: it looks sources up, formats them
//! (citeproc, with the official CSL styles), writes the library and publishes it whole
//! (`referencesChanged`). The shell draws the panel and asks for changes by command.
//! Formatting happens on the page so there is one formatter, and the entries the panel
//! shows are the entries the bibliography prints.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use typeshare::typeshare;

use super::common::EditorTarget;

/* ---------------- the schema, published once ---------------- */

/// How a field is edited.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReferenceFieldInput {
    Text,
    /// Several lines — an abstract, a description.
    Multiline,
    /// An ISO date, as much of it as is known: `2021`, `2021-03`, `2021-03-04`.
    Date,
    Url,
}

/// One field a kind of source has. `key` is the CSL variable it fills.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceFieldSpec {
    pub key: String,
    pub label: String,
    pub placeholder: String,
    pub input: ReferenceFieldInput,
    /// Wanted by most styles; an empty one marks the source incomplete.
    pub required: bool,
}

/// A kind of source — a book, a journal article, a YouTube video.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceKindSpec {
    pub id: String,
    pub label: String,
    /// Which part of the "new source" menu it is listed in.
    pub group: String,
    /// A semantic icon name (src/ui/icons.js).
    pub icon: String,
    pub fields: Vec<ReferenceFieldSpec>,
    /// The contributor roles it offers, first one the default (`author`, `editor`…).
    pub roles: Vec<String>,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContributorRoleSpec {
    pub id: String,
    pub label: String,
}

/// A citation style the page can format in.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CitationStyleSpec {
    pub id: String,
    /// "APA 7th edition".
    pub label: String,
    /// "APA", for a compact picker.
    pub short: String,
    /// What the style calls its bibliography: References, Works Cited, Bibliography.
    pub heading: String,
    /// Citations are numbered notes rather than (Author, Year) in the text.
    pub note_style: bool,
}

/// What the panel needs to build its forms and pickers. Sent once, when the page
/// mounts; the page is the one place kinds and styles are defined.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceSchema {
    pub kinds: Vec<ReferenceKindSpec>,
    pub roles: Vec<ContributorRoleSpec>,
    pub styles: Vec<CitationStyleSpec>,
}

/* ---------------- a source ---------------- */

/// A person or an organisation. An organisation has `literal` and no names.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Contributor {
    pub role: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub family: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub given: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub literal: Option<String>,
}

#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReferenceStatus {
    /// Being looked up.
    Resolving,
    Complete,
    /// Found, or entered, but a field most styles want is empty.
    Incomplete,
    /// The lookup found nothing; the writer fills it in.
    Failed,
}

/// Where a source came from: what was pasted, and what the page took it to be
/// (`url`, `doi`, `isbn`, `arxiv`, `pmid`, `search`, `manual`).
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceOrigin {
    pub kind: String,
    pub input: String,
}

/// A possible match for a title typed into quick add.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceCandidate {
    pub title: String,
    /// Authors · year · publisher, for telling matches apart.
    pub detail: String,
    pub kind: String,
    pub contributors: Vec<Contributor>,
    pub fields: HashMap<String, String>,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reference {
    pub id: String,
    /// A `ReferenceKindSpec` id.
    pub kind: String,
    pub contributors: Vec<Contributor>,
    /// Every other detail, by CSL variable name — `title`, `container-title`, `DOI`,
    /// `issued` (an ISO date)… Empty fields are absent.
    pub fields: HashMap<String, String>,
    /// Printed under the entry in an annotated bibliography.
    pub annotation: String,
    /// The writer's own; never printed.
    pub note: String,
    pub tags: Vec<String>,
    pub status: ReferenceStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<ReferenceOrigin>,
    /// Matches to choose from, after a title search.
    pub candidates: Vec<ReferenceCandidate>,
    /// Why the lookup failed, in words for the writer.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// A source as the panel shows it: formatted in the style of the document in view.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceView {
    pub reference: Reference,
    /// The bibliography entry, as HTML with only `i`, `b`, `sup`, `sub` and
    /// `span.sc` (small caps) in it.
    pub entry_html: String,
    /// The entry as plain text, for copying and filtering.
    pub entry_text: String,
    /// How it is cited in the text, "(Smith, 2021)".
    pub in_text: String,
    /// Keys of required fields that are empty.
    pub missing_fields: Vec<String>,
    /// The documents it is attached to.
    pub used_in: Vec<String>,
    /// Attached to the document in view.
    pub attached: bool,
    /// Cited in the document in view.
    pub cited: bool,
}

/* ---------------- a document's bibliography ---------------- */

#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BibliographyInclude {
    /// Only sources cited in the text — what every style asks for.
    Cited,
    /// Every source attached to the document, cited or not ("works consulted").
    Attached,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BibliographyOptions {
    pub include: BibliographyInclude,
    /// Print each source's annotation under its entry.
    pub annotated: bool,
    /// Add the bibliography to printouts and exports when the document has none of
    /// its own in the text. A book printed or exported whole gets one, at its end, for
    /// every chapter that asks for it.
    pub in_print: bool,
    /// Overrides the style's heading. Absent means the style's.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

/// The project's sources, as they stand for the document in view — the whole list,
/// sent when the library changes, the document changes or its style does.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferencesChanged {
    /// Absent when no text document is open; sources still list, unattached.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub doc_path: Option<String>,
    /// The document's style, or the project's when it has none of its own.
    pub style: String,
    pub project_style: String,
    pub bibliography: BibliographyOptions,
    /// The document has a bibliography block in it.
    pub has_bibliography: bool,
    /// Every source in the project, newest first.
    pub references: Vec<ReferenceView>,
}

/// Show a source in the panel — the writer ⌥-clicked its citation.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevealReference {
    pub id: String,
}

/* ---------------- what the shell asks for ---------------- */

/// Quick add: a URL, DOI, ISBN, arXiv id or PMID is looked up; anything else is
/// searched for as a title. The source exists at once, `resolving`, attached to the
/// document — the writer does not wait on the network.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddReferenceCommand {
    /// Chosen by the shell, so it can select the source it just asked for.
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub doc_path: Option<String>,
    pub input: String,
    /// Also cite it at the caret, in whichever editor is active.
    pub cite: bool,
}

/// A new, empty source of a kind, for entering by hand.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateReferenceCommand {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub doc_path: Option<String>,
    pub kind: String,
}

/// A change to a source. Only what is present changes; `fields` merges, and an empty
/// value removes the field.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferencePatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub contributors: Option<Vec<Contributor>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fields: Option<HashMap<String, String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub annotation: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateReferenceCommand {
    pub id: String,
    pub patch: ReferencePatch,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceRef {
    pub id: String,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetReferenceAttachedCommand {
    pub doc_path: String,
    pub id: String,
    pub attached: bool,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChooseReferenceCandidateCommand {
    pub id: String,
    pub index: u32,
}

/// Cite sources at the caret. Several ids make one citation: (Smith, 2020; Lee, 2021).
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InsertCitationCommand {
    /// Absent means whichever editor is active.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<EditorTarget>,
    pub ref_ids: Vec<String>,
    /// A page or other locator, for a single source: "42", "12–14".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub locator: Option<String>,
}

/// Put the bibliography at the end of the document, or move it there.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InsertBibliographyCommand {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<EditorTarget>,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetCitationStyleCommand {
    /// Absent sets only the project's default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub doc_path: Option<String>,
    pub style: String,
    /// Also make it the style of documents that have none of their own.
    pub make_project_default: bool,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetBibliographyOptionsCommand {
    pub doc_path: String,
    pub options: BibliographyOptions,
}
