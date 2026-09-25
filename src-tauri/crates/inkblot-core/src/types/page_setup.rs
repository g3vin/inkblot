//! Page setup: how a text document is laid out as physical pages in Print Layout,
//! and how it is printed, bound and exported.
//!
//! A document's setup is stored as the `pageSetup` attribute of its TipTap `doc`
//! node, so it travels inside `content` and every version snapshot without the
//! storage whitelist knowing about it. All lengths are millimetres — the unit every
//! ISO and trim size is defined in — and converted to CSS px (96/in) at layout time.
//!
//! The web page owns the setup and publishes it in `PageLayoutState`; the native
//! inspector is a view over that state and answers with `SetPageSetup`.

use serde::{Deserialize, Serialize};
use typeshare::typeshare;

#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PageOrientation {
    Portrait,
    Landscape,
}

/// Page-number numerals.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PageNumberFormat {
    Arabic,
    UpperRoman,
    LowerRoman,
}

/// Page margins. `inside`/`outside` are left/right on a recto (odd) page, and swap
/// on a verso when `PageSetup::mirror_margins` is set.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageMargins {
    pub top_mm: f64,
    pub bottom_mm: f64,
    pub inside_mm: f64,
    pub outside_mm: f64,
    /// Extra binding allowance added to the inside margin.
    pub gutter_mm: f64,
}

/// One running header or footer: three slots, each a template of literal text and
/// the tokens `{page}`, `{pages}`, `{title}`, `{chapter}` and `{author}`. On a verso
/// page of a mirrored setup, left and right swap so "outside" stays outside.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunningText {
    pub left: String,
    pub center: String,
    pub right: String,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageSetup {
    /// A `pageSizes.ts` preset id, or `"custom"`.
    pub preset_id: String,
    /// Portrait width and height; `orientation` decides which is horizontal.
    pub width_mm: f64,
    pub height_mm: f64,
    pub orientation: PageOrientation,
    pub margins: PageMargins,
    pub mirror_margins: bool,
    /// Text columns per page, 1–3.
    pub columns: u32,
    pub column_gap_mm: f64,
    /// The running head and foot of every page — or of recto pages only, when a
    /// verso override is set.
    pub header: RunningText,
    pub footer: RunningText,
    /// A different head/foot for verso (even) pages, as a book sets the title on
    /// the left page and the chapter on the right.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verso_header: Option<RunningText>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verso_footer: Option<RunningText>,
    /// Distance from the paper edge to the header's top / the footer's bottom.
    pub header_distance_mm: f64,
    pub footer_distance_mm: f64,
    /// No header or footer on a chapter's first page.
    pub different_first_page: bool,
    pub page_number_start: u32,
    pub page_number_format: PageNumberFormat,
    /// Minimum lines of a split paragraph left at a page's foot or carried to the
    /// next page's head. 1 turns widow/orphan control off.
    pub widow_orphan_lines: u32,
    /// A manual "recto" break, and each chapter of a compiled book, starts on an
    /// odd page, inserting a blank verso when needed.
    pub chapter_starts_on_recto: bool,
    /// The catalog format (`formats.ts`) this setup was made from, kept after it is
    /// changed so the inspector can say "Standard Manuscript (modified)".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format_id: Option<String>,
    /// How the text is set on the page. Absent prints in the editor's own font, as a
    /// document always did before it could be set for print.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub typography: Option<PrintTypography>,
    /// A title page before the text, printed and exported but never numbered.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title_page: Option<TitlePageOptions>,
}

/* ---------------- typography ---------------- */

#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LineSpacing {
    Single,
    OneAndAHalf,
    Double,
    /// `line_value` times the font's size.
    Multiple,
    /// Exactly `line_value` points from baseline to baseline, as a script is set.
    Exact,
}

#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PrintAlignment {
    Left,
    Justify,
}

/// How a chapter's first paragraph opens.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChapterOpening {
    Plain,
    /// A large initial set into the first lines.
    DropCap,
    /// The first line in small capitals.
    SmallCaps,
    DropCapAndSmallCaps,
}

/// Type for print: set on the page's text in Print Layout, on paper and in the PDF,
/// and carried into a DOCX's styles — never on the continuous editor.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintTypography {
    /// A CSS font family list: `"Courier Prime", Courier, monospace`.
    pub font_family: String,
    pub font_size_pt: f64,
    pub line_spacing: LineSpacing,
    /// The multiple, or the exact leading in points; unused otherwise.
    pub line_value: f64,
    pub first_line_indent_mm: f64,
    /// Space between paragraphs.
    pub paragraph_spacing_pt: f64,
    pub alignment: PrintAlignment,
    pub hyphenate: bool,
    /// What a horizontal rule prints as — a scene break: `#`, `* * *`, `❧`. Empty
    /// prints a blank line.
    pub scene_break: String,
    pub chapter_opening: ChapterOpening,
    /// How far down the page a chapter's title starts, below the top margin.
    pub chapter_sink_mm: f64,
    /// A paragraph after a heading or a scene break starts flush, as books set it.
    pub no_indent_after_break: bool,
}

#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TitlePageStyle {
    /// Contact details top-left, word count top-right, title and byline centred: the
    /// standard manuscript submission.
    Manuscript,
    /// Title, author, and nothing else: a book's title page.
    Book,
    /// Title, "Written by", author centred; contact details bottom-left.
    Screenplay,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TitlePageOptions {
    pub style: TitlePageStyle,
    pub show_contact: bool,
    pub show_word_count: bool,
}

/// Who wrote it, for title pages and running heads. One per app: it is the writer's,
/// not any one project's.
#[typeshare]
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AuthorProfile {
    /// The name on the work — a pen name, if there is one.
    pub byline: String,
    /// The name the contact details are under.
    pub legal_name: String,
    /// Street address, one line per line.
    pub address: String,
    pub email: String,
    pub phone: String,
    /// An agent or agency, when the work goes out through one.
    pub agent: String,
}

/* ---------------- binding and books ---------------- */

/// How a printed book is put together — which decides the order pages are laid on
/// sheets (see `imposition.ts`).
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BindingType {
    /// No imposition: one page per sheet side, in order.
    None,
    /// Folded sheets nested into signatures and sewn: case, Coptic, long-stitch.
    Signatures,
    /// Every page in one signature, stapled through the fold: a booklet.
    Saddle,
    /// Leaves cut apart and glued at the spine; two per sheet, in reading order.
    Perfect,
}

#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DuplexMode {
    /// The printer prints both sides (flip on short edge).
    Automatic,
    /// Every front, then the stack is fed back for the backs in reverse.
    Manual,
}

#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SheetFit {
    /// Pages keep their size and sit centred on the half-sheet, with crop marks.
    ActualSize,
    /// Pages scale to fill the half-sheet.
    Fit,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BindingSettings {
    pub binding: BindingType,
    /// Folios (folded sheets) per signature, 1–8; four (16 pages) is the hand-binding norm.
    pub sheets_per_signature: u32,
    /// The paper the sheets are printed on: a `pageSizes.ts` preset id.
    pub sheet_preset_id: String,
    pub sheet_fit: SheetFit,
    pub duplex: DuplexMode,
    /// For creep compensation; 0.1mm is ordinary 20lb / 75gsm paper. 0 turns it off.
    pub paper_thickness_mm: f64,
    pub crop_marks: bool,
    /// Also print the folding guide as a last sheet.
    pub include_guide: bool,
}

/// A folder (or the whole project) compiled as one book: its chapters are the
/// folder's documents in tree order. Kept per folder in preferences, not in any one
/// document, because it belongs to all of them.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookSettings {
    /// The folder's tree path; empty for the project root.
    pub folder: String,
    pub title: String,
    pub author: String,
    /// BCP 47, e.g. `en-US`. EPUB requires it.
    pub language: String,
    /// A project-relative image path, or a data URI.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cover_image: Option<String>,
    /// The book's own page setup; absent means each chapter's first document's.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_setup: Option<PageSetup>,
    pub binding: BindingSettings,
}
