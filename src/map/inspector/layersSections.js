/**
 * layersSections.js — the Layers tab: the writer's layers, and their saved views.
 *
 * A layer is a named set of places, routes, regions and labels (each item's
 * `layer`) that can be hidden (`visible`), so nothing on it is drawn, or locked, so
 * nothing on it can be picked up. A saved view is a camera and a day to come back
 * to: "Plate 3: the trinary, from above".
 */
import { formatDay } from '../../lib/map/calendar'
import { newId } from '../../lib/map/mapModel'

const ITEM_COLLECTIONS = ['pins', 'routes', 'regions', 'labels']

export function layersSections(ui, { map, dispatch, calendar, onSaveView, onShowView }) {
  const setLayers = (layers, label) => dispatch({ type: 'map/patch', patch: { layers }, meta: { coalesce: label } })
  const patchLayer = (id, patch) => setLayers(map.layers.map((layer) => (layer.id === id ? { ...layer, ...patch } : layer)), `layer-${id}`)
  const countOn = (id) => ITEM_COLLECTIONS.reduce((sum, collection) => sum + map[collection].filter((item) => item.layer === id).length, 0)
  const addLayer = () => setLayers([...map.layers, { id: newId(), name: `Layer ${map.layers.length + 1}`, visible: true, locked: false }])
  const removeLayer = (id) => {
    // What was on it stays, on no layer.
    const patch = { layers: map.layers.filter((layer) => layer.id !== id) }
    for (const collection of ITEM_COLLECTIONS) patch[collection] = map[collection].map((item) => (item.layer === id ? { ...item, layer: null } : item))
    dispatch({ type: 'map/patch', patch })
  }
  const setViews = (views) => dispatch({ type: 'map/patch', patch: { views } })

  return [
    ui.section('layers', 'Layers', [
      map.layers.length
        ? null
        : ui.note('Gather places, routes and regions on layers to hide or lock them together: the old roads, the war, the second age.'),
      ...map.layers.map((layer) =>
        ui.group(`layers.${layer.id}`, layer.name + (layer.visible ? '' : ' (hidden)'), [
          ui.text(`layers.${layer.id}.name`, 'Name', layer.name, (name) => patchLayer(layer.id, { name: name.trim() || layer.name })),
          ui.toggle(`layers.${layer.id}.visible`, 'Shown', layer.visible, (visible) => patchLayer(layer.id, { visible })),
          ui.toggle(`layers.${layer.id}.locked`, 'Locked', layer.locked, (locked) => patchLayer(layer.id, { locked })),
          ui.stat('On it', String(countOn(layer.id))),
          ui.buttons([ui.button(`layers.${layer.id}.delete`, 'Delete layer', () => removeLayer(layer.id), { role: 'destructive' })]),
        ], { collapsible: true })
      ),
      map.layers.length ? ui.note('Put something on a layer from its When section.') : null,
    ], [ui.button('layers.add', 'Add layer', addLayer, { icon: 'add' })]),
    ui.section('views', 'Saved views', [
      map.views.length ? null : ui.note('Save the way you are looking at the map, and the day, to come back to it: a plate for a book, a scene’s vantage.'),
      ...map.views.map((saved) =>
        ui.group(`views.${saved.id}`, saved.name, [
          ui.text(`views.${saved.id}.name`, 'Name', saved.name, (name) => setViews(map.views.map((other) => (other.id === saved.id ? { ...other, name: name.trim() || other.name } : other)))),
          Number.isFinite(saved.day) ? ui.stat('Day', formatDay(calendar, saved.day)) : null,
          ui.buttons([
            ui.button(`views.${saved.id}.show`, 'Show', () => onShowView(saved)),
            ui.button(`views.${saved.id}.update`, 'Update', () => setViews(map.views.map((other) => (other.id === saved.id ? { ...other, ...onSaveView() } : other)))),
            ui.button(`views.${saved.id}.delete`, 'Delete', () => setViews(map.views.filter((other) => other.id !== saved.id)), { role: 'destructive' }),
          ]),
        ], { collapsible: true })
      ),
    ], [ui.button('views.save', 'Save this view', () => setViews([...map.views, { id: newId(), name: `View ${map.views.length + 1}`, ...onSaveView() }]), { icon: 'add' })]),
  ]
}
