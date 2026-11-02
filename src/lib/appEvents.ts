/**
 * appEvents.ts — the window events that more than one part of the page sends or hears,
 * and that no single module owns. Import the name instead of typing the string, so
 * every sender and listener of an event is found by its import.
 *
 * An event with one owner exports its name from that owner instead (PROJECT_FILES_CHANGED
 * in projectFiles.js, OPEN_HELP_EVENT in help.ts, …). Each name below notes its `detail`.
 */

/** File tree: start a new entry, or rename one in place. `{ type, parent, presetKey?, rename?, path?, name? }` */
export const FILETREE_NEW_ENTRY = 'filetree:new-entry'
/** File tree: create a project. No detail. */
export const FILETREE_NEW_PROJECT = 'filetree:new-project'
/** File tree: re-read the project list. No detail. */
export const FILETREE_REFRESH_PROJECTS = 'filetree:refresh-projects'
/** File tree: go back to the project list. No detail. */
export const FILETREE_SHOW_PROJECTS = 'filetree:show-projects'
/** File tree: expand or collapse folders. `{ action: 'expand-all' | 'collapse-all' }` */
export const FILETREE_FOLDERS_VISIBILITY = 'filetree:folders-visibility'
/** File tree: act on the chosen rows. `{ action, target? }` */
export const FILETREE_SELECTION = 'filetree:selection'

/** A document's version history changed. `{ projectName, docName }` */
export const VERSIONS_CHANGED = 'versions:changed'

/** Open the ⌘K palette. No detail. */
export const COMMAND_PALETTE = 'inkblot:command-palette'
/** Close the project and show them all. No detail. */
export const CLOSE_PROJECT = 'inkblot:close-project'
/** A project finished opening. `{ projectName, projectOpenId }` */
export const PROJECT_OPENED = 'inkblot:project-opened'

/** Show or hide page view. No detail. */
export const PRINT_LAYOUT_TOGGLE = 'inkblot:print-layout-toggle'
/** Open the page setup sheet. No detail. */
export const PAGE_SETUP = 'inkblot:page-setup'
/** The measurement units changed. No detail. */
export const PAGE_UNITS = 'inkblot:page-units'
/** A Finishing section opened or closed. No detail. */
export const FINISHING_SECTIONS = 'inkblot:finishing-sections'
/** Write the document as a format (prose, screenplay, …). `{ format }` */
export const WRITING_FORMAT = 'inkblot:writing-format'
/** Print. `{ scope: 'document' | 'folder', bound? }` */
export const PRINT_EVENT = 'inkblot:print'
/** Export. `{ format, scope, bound? }` */
export const EXPORT_EVENT = 'inkblot:export'
/** A step of a print or export job. A `PrintJobStatus` (printJobStatus.js). */
export const PRINT_JOB = 'inkblot:print-job'
/** Import a Fountain script. No detail. */
export const IMPORT_SCRIPT = 'inkblot:import-script'

/** A selection dragged out of the editor was let go. `{ selection, x, y, … }` */
export const EDITOR_SELECTION_DRAGEND = 'inkblot:editor-selection-dragend'
/** A selection dragged out of the editor landed on the clipboard. `{ text, selection, x, y, … }` */
export const EDITOR_DRAGEND_DROP_TO_CLIPBOARD = 'inkblot:editor-dragend-drop-to-clipboard'
