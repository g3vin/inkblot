/**
 * projectFiles.js — telling the file tree that something other than it wrote a
 * new document (a map opening a world's surface, say), so it shows up without a
 * reload. The editor listens and re-reads the project.
 */
export const PROJECT_FILES_CHANGED = 'inkblot:project-files-changed'

export const announceProjectFiles = () => window.dispatchEvent(new Event(PROJECT_FILES_CHANGED))
