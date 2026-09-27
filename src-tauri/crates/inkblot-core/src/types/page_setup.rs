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
    /// How pictures in the text are set. Absent sets them as they were placed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub images: Option<ImageTypesetting>,
}

/// Where a picture in the text sits across the text block.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ImageAlign {
    /// Centred, as a book sets its pictures.
    #[default]
    Center,
    /// Where the writer put it.
    AsPlaced,
}

/// How the pictures in a book's text are set for print.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ImageTypesetting {
    /// The widest a picture is set, as a percentage of the text block.
    pub max_width_pct: f64,
    pub align: ImageAlign,
    /// A picture never breaks from the caption under it.
    pub keep_with_caption: bool,
    /// Pictures that print at fewer dots per inch than this are pointed out.
    pub min_dpi: u32,
}

impl Default for ImageTypesetting {
    fn default() -> Self {
        Self { max_width_pct: 100.0, align: ImageAlign::Center, keep_with_caption: true, min_dpi: 300 }
    }
}

/// What a chapter's head shows beyond its title, kept on the chapter's own document
/// (the `chapter` attribute of its TipTap `doc` node), so it travels with it.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ChapterMeta {
    pub subtitle: String,
    /// The chapter's own heading picture: a project-relative path, or a data URI.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
    pub epigraph: String,
    pub epigraph_source: String,
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

/// A folder (or the whole project) compiled as one book. Kept per folder in the
/// project's `.inkblot-books.json` (`bookStore.js`), not in any one document, because it
/// belongs to all of them.
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
    /// Chapters left out of the book, by tree path. The rest print in tree order; a
    /// document added to the folder is in until it is left out.
    #[serde(default)]
    pub excluded: Vec<String>,
    #[serde(default)]
    pub chapter_numbering: ChapterNumbering,
    #[serde(default)]
    pub front_matter: FrontMatter,
    #[serde(default)]
    pub back_matter: BackMatter,
    /// Where the book is going to be printed, for the Publish tab's checks.
    #[serde(default)]
    pub publishing: PublishingTarget,
    /// How every chapter opens. Absent in a book set up before designs: the page
    /// derives one from `chapter_numbering` and the setup's recto rule.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chapter_design: Option<ChapterDesign>,
    /// How a part's divider page is set; absent uses the chapter design's.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub part_design: Option<ChapterDesign>,
    /// The book's contents in book order: chapters, parts, front and back matter. Its
    /// own order — the file tree is never changed by it. Empty until the book is first
    /// typeset: the chapters are then the folder's documents in tree order, less
    /// `excluded`, and the matter is `front_matter` and `back_matter`.
    #[serde(default)]
    pub items: Vec<BookItem>,
    /// Opening one of the folder's documents shows the others above and below it, in
    /// tree order, to scroll straight through.
    #[serde(default)]
    pub continuous: bool,
    /// The book's covers; `active_cover` is the one print, EPUB and export use.
    #[serde(default)]
    pub covers: Vec<CoverSet>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_cover: Option<String>,
    /// How the e-book differs from the printed book.
    #[serde(default)]
    pub digital: DigitalOptions,
}

/// What an e-book leaves out or sets differently from print. A reading system chooses
/// the page, the type size and — often — the font; what the book still decides is
/// whether its flourishes come with it.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DigitalOptions {
    /// A drop cap on each chapter's first letter, as in print. Some readers draw them
    /// badly at large type sizes.
    pub drop_caps: bool,
    /// The chapter's picture in its head, and a picture ornament.
    pub head_images: bool,
    /// The book's own font, where the reader lets the book choose; off leaves the
    /// reader's.
    pub publisher_font: bool,
    /// Scene breaks set as `* * *`, which every reader's font has, instead of the
    /// book's ornament, which some e-readers' fonts lack.
    pub plain_scene_breaks: bool,
    /// Pictures that are ornaments (dark on a clear ground) are inverted on a dark
    /// page, as a reader in night mode would otherwise lose them.
    pub invert_ornaments_in_dark: bool,
}

impl Default for DigitalOptions {
    fn default() -> Self {
        Self {
            drop_caps: true,
            head_images: true,
            publisher_font: true,
            plain_scene_breaks: false,
            invert_ornaments_in_dark: true,
        }
    }
}

/// A print-on-demand service, whose rules a book is checked against.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PublishingService {
    /// Not checked against anyone's rules.
    #[default]
    None,
    /// Amazon KDP paperback.
    Kdp,
    IngramSpark,
}

/// The paper a book is printed on, which sets how thick its spine is.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PaperStock {
    #[default]
    Cream,
    White,
    /// Colour interior, on heavier paper.
    Color,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PublishingTarget {
    pub service: PublishingService,
    pub paper: PaperStock,
}

/// How a chapter's number is written in its heading.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChapterNumberStyle {
    /// The chapters' own headings, as written.
    #[default]
    None,
    /// "Chapter One"
    Words,
    /// "Chapter 1"
    Numerals,
    /// "Chapter I"
    Roman,
}

/// Chapter headings a book adds as it compiles.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ChapterNumbering {
    pub style: ChapterNumberStyle,
    /// The word before the number — "Chapter", "Part" — or empty for the number alone.
    pub prefix: String,
    /// Keep the chapter's own title under its number.
    pub include_title: bool,
    /// The first chapter's number: 1, or 0 for a book that opens on "Chapter Zero".
    pub start_at: u32,
    /// Show each chapter's number beside it in the file tree.
    pub show_in_tree: bool,
}

impl Default for ChapterNumbering {
    fn default() -> Self {
        Self {
            style: ChapterNumberStyle::None,
            prefix: String::new(),
            include_title: false,
            start_at: 1,
            show_in_tree: false,
        }
    }
}

/* ---------------- chapter openings ---------------- */

/// Where a chapter starts, relative to the one before it.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChapterBreak {
    #[default]
    NewPage,
    /// A right-hand page, with a blank verso before it when needed.
    NewRightPage,
    /// Straight on after the chapter before, when its head and two lines fit.
    Continue,
}

#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HeadAlignment {
    Left,
    #[default]
    Center,
    Right,
}

/// How a line of a chapter head is set.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HeadCase {
    #[default]
    AsWritten,
    Upper,
    SmallCaps,
    Italic,
}

/// The decoration a chapter head carries.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OrnamentKind {
    #[default]
    None,
    /// A short rule.
    Rule,
    /// A typed glyph: `ornament_glyph`.
    Glyph,
    /// A picture: `ornament_image`.
    Image,
}

/// Where the ornament, or a chapter's own picture, sits in the head.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OrnamentPosition {
    /// Above the number.
    #[default]
    Above,
    /// Between the number and the title.
    Between,
    /// Below the title.
    Below,
}

/// How every chapter of a book opens: what its head shows and how it is set. The same
/// design heads the chapters in the continuous editor, on the Typeset pages, in print
/// and in every export — `ChapterHead.js` renders it for all of them.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ChapterDesign {
    /// The number label — "Chapter One" — as `ChapterNumbering` writes it.
    pub show_number: bool,
    pub show_title: bool,
    pub show_subtitle: bool,
    /// Each chapter's own heading picture, where it has one.
    pub show_image: bool,
    pub ornament: OrnamentKind,
    pub ornament_glyph: String,
    /// A project-relative image path, or a data URI.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ornament_image: Option<String>,
    pub ornament_position: OrnamentPosition,
    /// The picture's width, as a percentage of the text block.
    pub image_width_pct: f64,
    pub alignment: HeadAlignment,
    pub number_case: HeadCase,
    pub title_case: HeadCase,
    /// A CSS font family list for the head; absent sets it in the body's face.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub heading_font: Option<String>,
    pub number_size_pt: f64,
    pub title_size_pt: f64,
    pub chapter_break: ChapterBreak,
    /// The book style (`bookStyles.ts`) this design came from, kept once it is changed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style_id: Option<String>,
}

impl Default for ChapterDesign {
    fn default() -> Self {
        Self {
            show_number: false,
            show_title: true,
            show_subtitle: true,
            show_image: true,
            ornament: OrnamentKind::None,
            ornament_glyph: String::new(),
            ornament_image: None,
            ornament_position: OrnamentPosition::Above,
            image_width_pct: 40.0,
            alignment: HeadAlignment::Center,
            number_case: HeadCase::AsWritten,
            title_case: HeadCase::AsWritten,
            heading_font: None,
            number_size_pt: 12.0,
            title_size_pt: 20.0,
            chapter_break: ChapterBreak::NewPage,
            style_id: None,
        }
    }
}

/* ---------------- the book's contents ---------------- */

/// What an entry in a book's contents is.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BookItemKind {
    /// A manuscript document, by tree path.
    Chapter,
    /// A part divider: everything after it, to the next part or the back matter, is in it.
    Part,
    /// A page the book has of its own — a dedication, About the Author — kept as a real
    /// document in the book folder's `.book/`.
    Matter,
    /// A page laid out from the book's data: a title page, the contents.
    Generated,
}

/// Which page of front or back matter a matter document is.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MatterKind {
    AlsoBy,
    Copyright,
    Dedication,
    Epigraph,
    Foreword,
    Preface,
    Introduction,
    Afterword,
    Acknowledgements,
    AboutAuthor,
    Glossary,
    Excerpt,
    ReadingGuide,
    CallToAction,
    /// A half title or title page made editable.
    HalfTitle,
    TitlePage,
    Custom,
}

#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GeneratedKind {
    HalfTitle,
    TitlePage,
    Contents,
    /// Endnotes gathered at the end of the book.
    Notes,
    Bibliography,
}

/// What a chapter is, which decides whether it is numbered and what its head says.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChapterType {
    /// Numbered.
    #[default]
    Chapter,
    Prologue,
    Epilogue,
    Interlude,
    /// Headed by its title alone.
    Unnumbered,
}

#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PageStart {
    /// The next page, whichever side.
    #[default]
    Any,
    Recto,
    Verso,
}

#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PagePosition {
    #[default]
    Top,
    /// Down the page, as a chapter opens.
    Sunk,
    Centered,
    Bottom,
}

/// How a page of front or back matter sits: overrides of what its kind does by default.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PageOptions {
    pub start: PageStart,
    pub position: PagePosition,
    pub running_heads: bool,
    pub folio: bool,
    /// Show the page's heading (its kind's name, or its title).
    pub heading: bool,
}

/// One entry in a book's contents, in book order.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookItem {
    /// Stable within the book.
    pub id: String,
    pub kind: BookItemKind,
    /// A chapter's tree path, or a matter document's path (`<folder>/.book/…`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// A part's title, or a name given to a matter page.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Left out of the Typeset pages, print, export and the continuous document.
    #[serde(default)]
    pub hidden: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub matter: Option<MatterKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub generated: Option<GeneratedKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chapter_type: Option<ChapterType>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page: Option<PageOptions>,
}

/* ---------------- covers ---------------- */

/// How a cover image is fitted to the part of the cover it is for.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CoverFit {
    /// Fill the part, cropping what overflows.
    #[default]
    Fill,
    Fit,
    Stretch,
}

#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CoverPart {
    Front,
    Back,
    Spine,
    /// One image across back, spine and front.
    Wrap,
}

/// One version of a book's cover. The images are project-relative paths under
/// `.assets/covers/`; `wrap`, when set, is used instead of the three parts.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverSet {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub front: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub back: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spine: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wrap: Option<String>,
    #[serde(default)]
    pub fit: CoverFit,
    /// The spine width, in mm, the spine or wrap image was made for — so a page count
    /// that has changed since can be pointed out.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub made_for_spine_mm: Option<f64>,
}

/// The pages before the first chapter. Empty text leaves its page out.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FrontMatter {
    /// The title alone, on the first recto.
    pub half_title: bool,
    /// The copyright page, on the back of the title page.
    pub copyright: String,
    pub dedication: String,
    pub epigraph: String,
    /// Who the epigraph is by.
    pub epigraph_source: String,
    /// A table of contents with page numbers.
    pub contents: bool,
}

/// The pages after the last chapter, each under its own heading. Empty text leaves it out.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BackMatter {
    pub acknowledgements: String,
    pub about_the_author: String,
    /// The author's other books, one per line.
    pub also_by: String,
}
