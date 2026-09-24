/**
 * referenceKinds.js — the kinds of source a writer can cite, and what each one asks for.
 *
 * This is the one definition. The shell draws its forms from it (published as
 * `referenceSchema`), the formatter maps each kind to its CSL type, and the lookup
 * guesses a kind from what it found. Field keys are CSL variable names, so a record's
 * `fields` go to citeproc nearly as they are (`csl.js`).
 *
 * `required` means most styles print it — an empty one marks the source incomplete so
 * the panel can ask. `defaults` are filled in on a new source of the kind (a press
 * release is a report whose genre says so).
 */

const text = (key, label, placeholder = '', extra = {}) => ({ key, label, placeholder, input: 'text', required: false, ...extra })
const req = (spec) => ({ ...spec, required: true })

const TITLE = req(text('title', 'Title'))
const ISSUED = text('issued', 'Date published', 'YYYY-MM-DD, YYYY-MM or YYYY', { input: 'date' })
const ACCESSED = text('accessed', 'Date accessed', 'YYYY-MM-DD', { input: 'date' })
const URL_FIELD = text('URL', 'URL', 'https://…', { input: 'url' })
const DOI = text('DOI', 'DOI', '10.1000/xyz123')
const PUBLISHER = text('publisher', 'Publisher')
const PLACE = text('publisher-place', 'Place of publication', 'City')
const PAGES = text('page', 'Pages', '12–34')
const VOLUME = text('volume', 'Volume')
const ISSUE = text('issue', 'Issue')
const EDITION = text('edition', 'Edition', '2')
const ISBN = text('ISBN', 'ISBN')
const MEDIUM = text('medium', 'Medium / format')
const GENRE = text('genre', 'Type')
const ABSTRACT = text('abstract', 'Abstract', '', { input: 'multiline' })

export const CONTRIBUTOR_ROLES = [
  { id: 'author', label: 'Author' },
  { id: 'editor', label: 'Editor' },
  { id: 'translator', label: 'Translator' },
  { id: 'container-author', label: 'Book author' },
  { id: 'collection-editor', label: 'Series editor' },
  { id: 'director', label: 'Director' },
  { id: 'producer', label: 'Producer' },
  { id: 'executive-producer', label: 'Executive producer' },
  { id: 'script-writer', label: 'Writer' },
  { id: 'performer', label: 'Performer' },
  { id: 'composer', label: 'Composer' },
  { id: 'host', label: 'Host' },
  { id: 'guest', label: 'Guest' },
  { id: 'narrator', label: 'Narrator' },
  { id: 'illustrator', label: 'Illustrator' },
  { id: 'interviewer', label: 'Interviewer' },
  { id: 'recipient', label: 'Recipient' },
  { id: 'curator', label: 'Curator' },
]

const kind = (id, label, group, symbol, csl, roles, fields, defaults = {}) => ({ id, label, group, symbol, csl, roles, fields, defaults })

export const REFERENCE_KINDS = [
  /* ---------------- web ---------------- */
  kind('webpage', 'Web page', 'Web', 'globe', 'webpage', ['author', 'editor'], [
    TITLE, req(text('container-title', 'Website name')), PUBLISHER, ISSUED, req(URL_FIELD), ACCESSED,
  ]),
  kind('blogPost', 'Blog post', 'Web', 'text.bubble', 'post-weblog', ['author'], [
    TITLE, req(text('container-title', 'Blog name')), req(ISSUED), req(URL_FIELD), ACCESSED,
  ]),
  kind('socialPost', 'Social media post', 'Web', 'bubble.left.and.text.bubble.right', 'post', ['author'], [
    req(text('title', 'Post text', 'The first 20 words of the post')), req(text('container-title', 'Platform', 'Instagram, X, Reddit…')),
    GENRE, req(ISSUED), req(URL_FIELD), ACCESSED,
  ]),
  kind('newsArticle', 'News article', 'Web', 'newspaper', 'article-newspaper', ['author'], [
    TITLE, req(text('container-title', 'Publication', 'The New York Times')), text('section', 'Section'), PAGES,
    req(ISSUED), PLACE, URL_FIELD, ACCESSED,
  ]),
  kind('magazineArticle', 'Magazine article', 'Web', 'magazine', 'article-magazine', ['author'], [
    TITLE, req(text('container-title', 'Magazine')), VOLUME, ISSUE, PAGES, req(ISSUED), URL_FIELD, ACCESSED,
  ]),
  kind('pressRelease', 'Press release', 'Web', 'megaphone', 'report', ['author'], [
    TITLE, req(text('publisher', 'Organization')), req(ISSUED), GENRE, URL_FIELD, ACCESSED,
  ], { genre: 'Press release' }),

  /* ---------------- books ---------------- */
  kind('book', 'Book', 'Books', 'book.closed', 'book', ['author', 'editor', 'translator'], [
    TITLE, EDITION, VOLUME, text('collection-title', 'Series'), req(PUBLISHER), PLACE, req(ISSUED),
    ISBN, DOI, URL_FIELD, text('number-of-pages', 'Number of pages'),
  ]),
  kind('editedBook', 'Edited book', 'Books', 'books.vertical', 'book', ['editor', 'author', 'translator'], [
    TITLE, EDITION, VOLUME, req(PUBLISHER), PLACE, req(ISSUED), ISBN, DOI, URL_FIELD,
  ]),
  kind('ebook', 'E-book', 'Books', 'book.pages', 'book', ['author', 'editor', 'translator'], [
    TITLE, EDITION, req(PUBLISHER), req(ISSUED), text('medium', 'Format', 'Kindle, EPUB'), ISBN, DOI, URL_FIELD,
  ]),
  kind('chapter', 'Book chapter', 'Books', 'book', 'chapter', ['author', 'editor', 'container-author', 'translator'], [
    req(text('title', 'Chapter title')), req(text('container-title', 'Book title')), req(PAGES), EDITION,
    req(PUBLISHER), PLACE, req(ISSUED), ISBN, DOI,
  ]),
  kind('encyclopediaEntry', 'Encyclopedia or dictionary entry', 'Books', 'character.book.closed', 'entry-encyclopedia', ['author', 'editor'], [
    req(text('title', 'Entry')), req(text('container-title', 'Encyclopedia or dictionary')), EDITION, PUBLISHER,
    ISSUED, URL_FIELD, ACCESSED,
  ]),

  /* ---------------- academic ---------------- */
  kind('journalArticle', 'Journal article', 'Academic', 'doc.text', 'article-journal', ['author'], [
    TITLE, req(text('container-title', 'Journal')), req(VOLUME), ISSUE, req(PAGES), req(ISSUED), DOI, URL_FIELD, ABSTRACT,
  ]),
  kind('conferencePaper', 'Conference paper', 'Academic', 'person.3', 'paper-conference', ['author', 'editor'], [
    TITLE, text('container-title', 'Proceedings title'), req(text('event-title', 'Conference')), text('event-place', 'Conference location'),
    PAGES, PUBLISHER, req(ISSUED), DOI, URL_FIELD,
  ]),
  kind('thesis', 'Thesis or dissertation', 'Academic', 'graduationcap', 'thesis', ['author'], [
    TITLE, req(text('genre', 'Type', 'Doctoral dissertation, Master’s thesis')), req(text('publisher', 'University')),
    PLACE, req(ISSUED), text('number', 'Publication number'), text('archive', 'Database', 'ProQuest Dissertations & Theses'), URL_FIELD,
  ]),
  kind('report', 'Report', 'Academic', 'doc.richtext', 'report', ['author', 'editor'], [
    TITLE, text('number', 'Report number'), req(text('publisher', 'Institution')), PLACE, req(ISSUED), DOI, URL_FIELD,
  ]),
  kind('governmentDocument', 'Government document', 'Academic', 'building.columns', 'report', ['author'], [
    TITLE, req(text('publisher', 'Agency')), text('number', 'Document number'), PLACE, req(ISSUED), URL_FIELD, ACCESSED,
  ]),
  kind('preprint', 'Preprint', 'Academic', 'doc.badge.clock', 'article', ['author'], [
    TITLE, req(text('publisher', 'Repository', 'arXiv, SSRN, bioRxiv')), text('number', 'Identifier'), req(ISSUED), DOI, URL_FIELD,
  ]),
  kind('dataset', 'Dataset', 'Academic', 'tablecells', 'dataset', ['author'], [
    TITLE, req(text('publisher', 'Publisher or repository')), text('version', 'Version'), MEDIUM, req(ISSUED), DOI, URL_FIELD, ACCESSED,
  ]),

  /* ---------------- media ---------------- */
  kind('video', 'Online video', 'Media', 'play.rectangle', 'motion_picture', ['author', 'director'], [
    TITLE, req(text('container-title', 'Platform', 'YouTube, Vimeo')), text('dimensions', 'Length', '12:34'),
    req(ISSUED), req(URL_FIELD), ACCESSED,
  ], { medium: 'Video' }),
  kind('film', 'Film', 'Media', 'film', 'motion_picture', ['director', 'producer', 'script-writer', 'performer'], [
    TITLE, req(text('publisher', 'Studio')), req(ISSUED), text('dimensions', 'Running time'), MEDIUM, URL_FIELD,
  ], { medium: 'Film' }),
  kind('tvEpisode', 'TV episode', 'Media', 'tv', 'broadcast', ['director', 'script-writer', 'executive-producer'], [
    req(text('title', 'Episode title')), req(text('container-title', 'Series')), text('volume', 'Season'), text('number', 'Episode'),
    req(text('publisher', 'Network or studio')), req(ISSUED), URL_FIELD,
  ], { genre: 'TV series episode' }),
  kind('podcast', 'Podcast episode', 'Media', 'mic', 'broadcast', ['host', 'guest', 'executive-producer'], [
    req(text('title', 'Episode title')), req(text('container-title', 'Podcast')), text('number', 'Episode'),
    text('publisher', 'Production company'), req(ISSUED), URL_FIELD,
  ], { genre: 'Audio podcast episode' }),
  kind('music', 'Song or album', 'Media', 'music.note', 'song', ['composer', 'performer', 'author'], [
    TITLE, text('container-title', 'Album'), req(text('publisher', 'Label')), req(ISSUED), MEDIUM, URL_FIELD,
  ]),
  kind('artwork', 'Artwork or image', 'Media', 'photo.artframe', 'graphic', ['author', 'illustrator', 'curator'], [
    TITLE, ISSUED, text('medium', 'Medium', 'Oil on canvas'), text('dimensions', 'Dimensions'), text('archive', 'Museum or collection'),
    text('archive-place', 'Location'), URL_FIELD, ACCESSED,
  ]),
  kind('map', 'Map', 'Media', 'map', 'map', ['author'], [
    TITLE, text('scale', 'Scale', '1:50,000'), req(PUBLISHER), PLACE, req(ISSUED), URL_FIELD,
  ]),

  /* ---------------- legal ---------------- */
  kind('legalCase', 'Court case', 'Legal', 'scalemass', 'legal_case', ['author'], [
    req(text('title', 'Case name', 'Brown v. Board of Education')), text('container-title', 'Reporter', 'U.S.'), VOLUME,
    text('page', 'First page'), req(text('authority', 'Court')), text('number', 'Docket number'), req(ISSUED), URL_FIELD,
  ]),
  kind('statute', 'Statute or bill', 'Legal', 'text.book.closed', 'legislation', ['author'], [
    TITLE, text('container-title', 'Code', 'U.S.C.'), text('section', 'Section'), text('number', 'Public law number'), req(ISSUED), URL_FIELD,
  ]),
  kind('patent', 'Patent', 'Legal', 'lightbulb', 'patent', ['author'], [
    TITLE, req(text('number', 'Patent number')), req(text('authority', 'Issued by', 'U.S. Patent and Trademark Office')), req(ISSUED), URL_FIELD,
  ]),
  kind('standard', 'Standard', 'Legal', 'checkmark.seal', 'standard', ['author'], [
    TITLE, req(text('number', 'Standard number', 'ISO 8601:2019')), req(text('publisher', 'Organization')), req(ISSUED), URL_FIELD,
  ]),

  /* ---------------- other ---------------- */
  kind('software', 'Software', 'Other', 'app.badge', 'software', ['author'], [
    TITLE, text('version', 'Version'), PUBLISHER, req(ISSUED), text('medium', 'Platform'), req(URL_FIELD), DOI,
  ]),
  kind('interview', 'Interview', 'Other', 'person.2.wave.2', 'interview', ['author', 'interviewer'], [
    text('title', 'Title'), text('container-title', 'Published in'), MEDIUM, req(ISSUED), URL_FIELD,
  ], { medium: 'Interview' }),
  kind('speech', 'Speech or lecture', 'Other', 'person.wave.2', 'speech', ['author'], [
    TITLE, req(text('event-title', 'Event')), text('event-place', 'Place'), GENRE, req(ISSUED), URL_FIELD,
  ], { genre: 'Lecture' }),
  kind('personalCommunication', 'Personal communication or email', 'Other', 'envelope', 'personal_communication', ['author', 'recipient'], [
    text('title', 'Subject'), text('genre', 'Type', 'Email, letter, conversation'), req(ISSUED),
  ], { genre: 'Email' }),
  kind('manuscript', 'Archival document or manuscript', 'Other', 'archivebox', 'manuscript', ['author'], [
    TITLE, GENRE, ISSUED, req(text('archive', 'Archive')), text('archive_location', 'Location in archive', 'Box 3, Folder 12'),
    text('archive-place', 'Archive location'), URL_FIELD,
  ]),
]

const BY_ID = new Map(REFERENCE_KINDS.map((spec) => [spec.id, spec]))

export const kindSpec = (id) => BY_ID.get(id) || BY_ID.get('webpage')

/** The kind a CSL item of `type` is taken as when it arrives from a lookup. */
const FROM_CSL = {
  webpage: 'webpage',
  'post-weblog': 'blogPost',
  post: 'socialPost',
  'article-newspaper': 'newsArticle',
  'article-magazine': 'magazineArticle',
  book: 'book',
  chapter: 'chapter',
  'entry-encyclopedia': 'encyclopediaEntry',
  'entry-dictionary': 'encyclopediaEntry',
  entry: 'encyclopediaEntry',
  'article-journal': 'journalArticle',
  'paper-conference': 'conferencePaper',
  thesis: 'thesis',
  report: 'report',
  article: 'preprint',
  dataset: 'dataset',
  motion_picture: 'film',
  broadcast: 'tvEpisode',
  song: 'music',
  graphic: 'artwork',
  map: 'map',
  legal_case: 'legalCase',
  legislation: 'statute',
  bill: 'statute',
  patent: 'patent',
  standard: 'standard',
  software: 'software',
  interview: 'interview',
  speech: 'speech',
  personal_communication: 'personalCommunication',
  manuscript: 'manuscript',
}

export const kindForCslType = (type) => FROM_CSL[type] || 'webpage'

/** Required fields of `kind` that `fields` leaves empty. A source needs a creator too:
 *  an author, editor, … — or, failing any, a title to stand in (every style falls back
 *  on the title), so only the fields are checked. */
export const missingFields = (kindId, fields = {}) => kindSpec(kindId).fields
  .filter((field) => field.required && !String(fields[field.key] || '').trim())
  .map((field) => field.key)

/** The schema as the shell receives it (`ReferenceSchema`), styles added by the caller. */
export const publishedKinds = () => REFERENCE_KINDS.map(({ id, label, group, symbol, roles, fields }) => ({
  id, label, group, symbol, roles, fields,
}))
