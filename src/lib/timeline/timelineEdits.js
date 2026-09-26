/**
 * timelineEdits.js — committing an edit to the chronology, and everything it moves.
 *
 * An event linked to a map journey's leg (`mapLeg`) leaves when the leg departs. Move
 * the event and the leg moves with it: the map is edited as part of the same commit,
 * and the leg's old departure is kept so that one undo puts both back.
 */
import { eventById, isDated } from './timelineModel'
import { readLegDepart, setLegDepart } from './journeys'
import { commitStoryTimeline, loadStoryTimeline, peekCommittedTimeline } from './timelineStore'

/** The leg moves an edit implies: events whose start changed, with a leg linked. */
async function legEffects(projectName, before, after) {
  const effects = []
  for (const event of after.events) {
    const legs = event.links.filter((link) => link.kind === 'mapLeg')
    if (!legs.length || !isDated(event)) continue
    const previous = eventById(before, event.id)
    if (previous && previous.start === event.start) continue
    for (const link of legs) {
      const old = await readLegDepart(projectName, link.map, link.traveler, link.leg)
      if (old === undefined) continue
      const start = event.start
      effects.push({
        redo: () => setLegDepart(projectName, link.map, link.traveler, link.leg, start),
        undo: () => setLegDepart(projectName, link.map, link.traveler, link.leg, old),
      })
    }
  }
  return effects
}

/**
 * Commit `edit` (a function of the committed chronology) as one undo step, with
 * `extraEffects` — edits to other files the gesture already made — and any leg moves
 * it implies, which are made here.
 */
export async function commitTimelineEdit(projectName, label, edit, extraEffects = []) {
  if (!projectName) return null
  await loadStoryTimeline(projectName)
  const before = peekCommittedTimeline(projectName)
  const after = edit(before)
  if (after === before && !extraEffects.length) return before
  const effects = await legEffects(projectName, before, after)
  for (const effect of effects) await effect.redo()
  return commitStoryTimeline(projectName, after, { label, effects: [...extraEffects, ...effects] })
}
