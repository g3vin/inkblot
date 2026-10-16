/**
 * systemSections.js — a star system's own settings in the Map tab: how distances
 * are drawn, how its plane sits in space, how its bodies move (fixed ellipses, or
 * everyone pulling on everyone), and the list of its bodies.
 *
 * For a system whose bodies all pull on each other the section says whether it
 * holds together over the story, and if not, who leaves and when (nbody.js).
 */
import { formatDay } from '../../lib/map/calendar'
import { makeStable, stabilityOf, toNbody } from '../../lib/map/nbody'
import { newSeed } from '../../lib/map/seeded'
import { presetSystem, SYSTEM_PRESETS } from '../../lib/map/systemPresets'
import { BODY_KIND_LABELS } from './itemSections'

const nameOf = (map, id) => {
  const body = map.system.bodies.find((candidate) => candidate.id === id)
  return body?.name || BODY_KIND_LABELS[body?.kind] || 'A body'
}

export function systemSections(ui, { map, dispatch, calendar, onSelect, onDay, focusBody, onFocusBody, motionCheck, onNotice }) {
  const { system } = map
  const patchSystem = (patch) => dispatch({ type: 'section/patch', section: 'system', patch })
  const nbody = system.dynamics === 'nbody'
  const template = nbody ? SYSTEM_PRESETS.find((preset) => preset.id === system.template?.id) : null
  const sections = []

  sections.push(ui.section('system', 'Star system', [
    ui.choice(
      'system.radial',
      'Distances drawn',
      system.display.radial,
      [{ value: 'log', label: 'Squeezed, so everything fits' }, { value: 'linear', label: 'To scale' }],
      (radial) => patchSystem({ display: { ...system.display, radial } })
    ),
    ui.note('Measurements and travel times always use true distances. Double-click a body to follow it.'),
    focusBody ? ui.buttonField('system.unfollow', 'Stop following', () => onFocusBody(null)) : null,
    ...system.bodies.map((body) =>
      ui.listRow(`system.body.${body.id}`, body.name || BODY_KIND_LABELS[body.kind] || body.kind, () => onSelect('body', body.id), { indent: body.parent ? 1 : 0 })
    ),
    ui.group('system.plane', 'Tilt', [
    ui.number('system.tilt', 'Tilted by', system.plane.tiltDeg, (tiltDeg) => patchSystem({ plane: { ...system.plane, tiltDeg } }), {
      min: 0,
      max: 180,
      step: 1,
      suffix: '°',
      help: 'How far the plane the planets orbit in leans from its galaxy’s.',
    }),
    ui.number('system.heading', 'Facing', system.plane.headingDeg, (headingDeg) => patchSystem({ plane: { ...system.plane, headingDeg } }), {
      min: 0,
      max: 360,
      step: 1,
      suffix: '°',
      help: 'Which way the tilt leans.',
    }),
    ], { collapsible: true }),
  ]))

  const motion = [
    ui.choice(
      'system.dynamics',
      'Bodies move',
      system.dynamics,
      [{ value: 'kepler', label: 'On fixed orbits' }, { value: 'nbody', label: 'Pulling on each other' }],
      (dynamics) => {
        if (dynamics === system.dynamics) return
        if (dynamics === 'nbody') patchSystem({ ...toNbody(system), template: null })
        else patchSystem({ dynamics: 'kepler' })
      }
    ),
  ]
  if (!nbody) {
    motion.push(ui.note('Each body follows its own ellipse. For three stars, or a planet that might be flung out, let them pull on each other.'))
  } else {
    const verdict = motionCheck?.verdict || stabilityOf(system)
    if (verdict.stable) {
      motion.push(ui.note('Holds together for the length of your story.'))
    } else {
      const { id, day } = verdict.ejected
      motion.push(ui.note(`Comes apart: ${nameOf(map, id)} leaves for good by ${formatDay(calendar, day)}.`))
      motion.push(ui.buttons([
        ui.button('system.ejection', 'Go to that day', () => onDay?.(day)),
        ui.button('system.steady', 'Make it stable', () => {
          const steadied = makeStable(system)
          if (steadied) patchSystem({ bodies: steadied.system.bodies, dynamics: 'nbody', template: null })
          onNotice?.(steadied ? `Steadied. ${steadied.how}` : 'No small change holds these together. Try moving a body further out.')
        }),
      ]))
    }
    if (verdict.closest && verdict.closest.au < 0.05) {
      const [a, b] = verdict.closest.ids
      motion.push(ui.stat('Closest pass', `${nameOf(map, a)} and ${nameOf(map, b)}, ${formatDay(calendar, verdict.closest.day)}`))
    }
    if (template) {
      const rebuild = (patch) => {
        const next = { ...system.template, ...patch }
        const built = presetSystem(template.id, { seed: next.seed, perturb: next.perturb })
        patchSystem({ bodies: built.bodies, template: built.template })
      }
      motion.push(ui.number('system.perturb', 'Nudge', Math.round((system.template.perturb || 0) * 1000) / 10, (percent) => rebuild({ perturb: (percent || 0) / 100 }), {
        min: 0,
        max: 20,
        step: 0.5,
        suffix: '%',
        help: 'Knock the starting speeds off by up to this much. A stable dance may survive a nudge; a chaotic one never repeats.',
      }))
      motion.push(ui.buttons([ui.button('system.reroll', 'Roll again', () => rebuild({ seed: newSeed() }))]))
      motion.push(ui.note('Rolling again replaces the starting places and speeds of these bodies.'))
    }
    motion.push(ui.number('system.step', 'Step', system.nbody.stepDays, (stepDays) => patchSystem({ nbody: { ...system.nbody, stepDays } }), {
      min: 0.001,
      max: 10,
      step: 0.05,
      suffix: 'days',
      help: 'Smaller is more exact and slower. Close passes are split finer on their own.',
    }))
  }
  sections.push(ui.section('system.motion', 'Motion', motion))
  return sections
}
