/**
 * bubbleForms.ts — saved versions ("forms") of a bubble arrangement.
 *
 * A session keeps any number of forms. The bubbles on screen are always one arrangement
 * — the one written into the document when the editor closes — and a form is a copy of
 * one, saved to come back to. Which form is showing is never stored: it is the form the
 * arrangement equals, ids and all, since showing a form copies it exactly. None equal
 * means the arrangement is unsaved.
 *
 * Forms are pages, in the order they were saved, and the unsaved arrangement is one more
 * page after them. Leaving it for a form keeps it (`unsaved`), so coming back finds it
 * as it was; it is only let go once another arrangement becomes the unsaved one, by an
 * edit to a form that is showing. Undo brings back any of it.
 *
 * The Swift shell's `BubbleForms.swift` is the same rules; a session saved in one is
 * reopened in the other.
 */
import { BubbleMode } from '../types'
import type { BubbleAside, BubbleForm, BubbleSession, BubbleWord } from '../types'
import { newBubbleId } from './bubbleText'

export interface Arrangement {
  words: BubbleWord[]
  aside: BubbleAside[]
  mode: BubbleMode
}

export interface FormsState extends Arrangement {
  forms: BubbleForm[]
  /** The unsaved arrangement, kept while a form is showing in its place. */
  unsaved: Arrangement | null
}

const sameWords = (a: BubbleWord[], b: BubbleWord[]): boolean => (
  a.length === b.length && a.every((word, index) => word.id === b[index].id && word.text === b[index].text)
)

const sameAside = (a: BubbleAside[], b: BubbleAside[]): boolean => (
  a.length === b.length && a.every((word, index) => {
    const other = b[index]
    return word.id === other.id && word.text === other.text && word.x === other.x && word.y === other.y
  })
)

/** Whether the arrangement is exactly this form. */
export const isForm = (arrangement: Arrangement, form: BubbleForm): boolean => (
  (form.mode ?? BubbleMode.Words) === arrangement.mode
  && sameWords(form.words, arrangement.words)
  && sameAside(form.aside ?? [], arrangement.aside)
)

/** The form showing, or -1 if the arrangement is unsaved. */
export const currentForm = (state: FormsState): number => (
  state.forms.findIndex((form) => isForm(state, form))
)

/** How many pages there are to move between: every form, and the unsaved one if any. */
export const formPages = (state: FormsState): number => {
  const unsavedPage = currentForm(state) === -1 || state.unsaved ? 1 : 0
  return state.forms.length + unsavedPage
}

/** The page showing: a form's index, or `forms.length` for the unsaved arrangement. */
export const formPage = (state: FormsState): number => {
  const current = currentForm(state)
  return current === -1 ? state.forms.length : current
}

const arrangementOf = (state: Arrangement): Arrangement => ({
  words: state.words, aside: state.aside, mode: state.mode,
})

const formOf = (arrangement: Arrangement, id: string): BubbleForm => ({
  id,
  words: arrangement.words,
  aside: arrangement.aside,
  ...(arrangement.mode === BubbleMode.Words ? {} : { mode: arrangement.mode }),
})

/** The arrangement saved as a new form, after the others. Nothing if it is one already. */
export const saveForm = (state: FormsState, id: string = newBubbleId('form')): FormsState => {
  if (currentForm(state) !== -1) return state
  return { ...state, forms: [...state.forms, formOf(state, id)], unsaved: null }
}

/** Show a page: a form, or (at `forms.length`) the unsaved arrangement. */
export const showFormPage = (state: FormsState, page: number): FormsState => {
  const current = formPage(state)
  if (page === current || page < 0 || page >= formPages(state)) return state
  const unsaved = currentForm(state) === -1 ? arrangementOf(state) : state.unsaved
  if (page === state.forms.length) {
    if (!unsaved) return state
    return { ...state, ...unsaved, unsaved: null }
  }
  const form = state.forms[page]
  return {
    ...state,
    words: form.words,
    aside: form.aside ?? [],
    mode: form.mode ?? BubbleMode.Words,
    unsaved,
  }
}

/**
 * A form deleted. The bubbles on screen stay as they are: if they were that form, they
 * are the unsaved arrangement now, in place of any that was kept.
 */
export const deleteForm = (state: FormsState, index: number): FormsState => {
  if (index < 0 || index >= state.forms.length) return state
  const wasShowing = currentForm(state) === index
  return {
    ...state,
    forms: state.forms.filter((_, at) => at !== index),
    unsaved: wasShowing ? null : state.unsaved,
  }
}

/**
 * After an edit to the bubbles. An edited form is the unsaved arrangement now; the one
 * kept from before is let go (undo still has it).
 */
export const settleForms = (state: FormsState): FormsState => (
  state.unsaved && currentForm(state) === -1 ? { ...state, unsaved: null } : state
)

/** A session's arrangement, forms and kept unsaved arrangement, as rules above take them. */
export const formsStateOf = (session: BubbleSession): FormsState => ({
  words: Array.isArray(session.words) ? session.words : [],
  aside: Array.isArray(session.aside) ? session.aside : [],
  mode: session.mode ?? BubbleMode.Words,
  forms: Array.isArray(session.forms) ? session.forms : [],
  unsaved: session.unsaved
    ? { words: session.unsaved.words ?? [], aside: session.unsaved.aside ?? [], mode: session.unsaved.mode ?? BubbleMode.Words }
    : null,
})

/** The session, arranged as `state` says. */
export const withFormsState = (session: BubbleSession, state: FormsState): BubbleSession => {
  const { unsaved: _kept, ...rest } = session
  return {
    ...rest,
    words: state.words,
    aside: state.aside,
    mode: state.mode,
    forms: state.forms,
    ...(state.unsaved ? { unsaved: formOf(state.unsaved, 'unsaved') } : {}),
  }
}
