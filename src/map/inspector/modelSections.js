/**
 * modelSections.js — a model map's own settings: how big one of the model's units
 * is, which way is up, and Replace the model (its places stay where they are).
 */
export function modelSections(ui, { map, dispatch, onChooseModel }) {
  const { model } = map
  const patchModel = (patch) => dispatch({ type: 'section/patch', section: 'model', patch })
  return [
    ui.section('model', '3D model', [
      ui.number('model.metresPerUnit', 'One unit is', model.metresPerUnit, (metresPerUnit) => patchModel({ metresPerUnit }), {
        min: 0.001, step: 0.1, suffix: 'm', help: 'Most models are made in metres. One made in centimetres is 0.01.',
      }),
      ui.choice('model.up', 'Up is', model.up, [{ value: 'y', label: 'Y (most tools)' }, { value: 'z', label: 'Z (Blender, CAD)' }], (up) => patchModel({ up })),
      onChooseModel ? ui.buttons([ui.button('model.replace', 'Replace the model…', onChooseModel)]) : null,
      ui.note('A .glb file, or a .gltf with everything inside it. Draco-compressed models aren’t supported yet.'),
    ]),
  ]
}
