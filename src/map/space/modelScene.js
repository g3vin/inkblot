/**
 * modelScene.js — a 3D model as a map: a space station, a ship, a city block.
 *
 * The model is a glTF (`.glb`, or a self-contained `.gltf`) from the project's
 * assets, loaded with three's GLTFLoader (meshopt-compressed models too; Draco is
 * not supported). It is lit by a neutral studio environment so its own materials
 * read as their makers meant.
 *
 * Places on a model are pins in the model's own units (`model.metresPerUnit` makes
 * them metres), set where a click meets its surface (`raycast`). A model made with
 * z up (`model.up: 'z'`) is stood upright; its pins keep the model's own axes.
 *
 * Same shape as the other scenes (systemScene.js): the space view does the rest.
 */
import { Box3, DirectionalLight, Group, PMREMGenerator, Sphere, Vector3 } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { assetUrl } from '../../lib/assets'

/**
 * Build the scene for a model map. `renderer` lights it; `onLoaded()` is called
 * once the model is in (or `onError(message)` if it cannot be).
 */
export function createModelScene(map, { projectName, renderer, scene, onLoaded, onError }) {
  const root = new Group()
  const plane = new Group()
  root.add(plane)
  const zUp = map.model.up === 'z'
  // Stand a z-up model upright: its z becomes the scene's y.
  if (zUp) plane.rotation.x = -Math.PI / 2
  let model = null
  let bounds = new Sphere(new Vector3(), 1)
  let disposed = false

  const pmrem = new PMREMGenerator(renderer)
  const room = new RoomEnvironment()
  const environment = pmrem.fromScene(room, 0.04).texture
  const previousEnvironment = scene.environment
  const previousIntensity = scene.environmentIntensity
  scene.environment = environment
  // The room fills the shadows softly; a key light from above gives the model its shape.
  scene.environmentIntensity = 0.55
  const key = new DirectionalLight(0xffffff, 1.6)
  root.add(key, key.target)

  if (map.model.asset) {
    void assetUrl(projectName, map.model.asset).then((url) => {
      if (disposed || !url) return
      const loader = new GLTFLoader()
      loader.setMeshoptDecoder(MeshoptDecoder)
      loader.load(
        url,
        (gltf) => {
          if (disposed) return
          model = gltf.scene
          plane.add(model)
          plane.updateMatrixWorld(true)
          bounds = new Box3().setFromObject(model).getBoundingSphere(new Sphere())
          key.position.copy(bounds.center).add(new Vector3(0.6, 1, 0.8).multiplyScalar(bounds.radius * 2))
          key.target.position.copy(bounds.center)
          onLoaded?.()
        },
        undefined,
        (error) => {
          console.error('[map] the model could not be loaded:', error)
          onError?.(/draco/i.test(String(error?.message)) ? 'This model is Draco-compressed, which isn’t supported yet. Export it without Draco, then try again.' : 'This model could not be opened.')
        }
      )
    })
  }

  return {
    root,
    plane,
    // Pins are in the model's own coordinates: the plane group's space.
    toScene: (point) => [point[0], point[1], point[2] || 0],
    fromScene: (local) => [local[0], local[1], local[2]],
    /** Where a ray meets the model, in its own coordinates (or null). */
    raycast: (raycaster) => {
      if (!model) return null
      const [hit] = raycaster.intersectObject(model, true)
      if (!hit) return null
      const local = plane.worldToLocal(hit.point.clone())
      return [local.x, local.y, local.z]
    },
    /** The model as placed, for a line drawing of it (plot/plotModel.js); null until it is in. */
    plotObject: () => (model ? plane : null),
    setDay: () => {},
    beforeRender: () => {},
    bodyAt: () => null,
    hitList: () => [],
    extent: () => ({ centre: bounds.center.clone(), radius: Math.max(bounds.radius, 1e-3) }),
    dispose() {
      disposed = true
      scene.environment = previousEnvironment
      scene.environmentIntensity = previousIntensity
      environment.dispose()
      pmrem.dispose()
      model?.traverse((object) => {
        object.geometry?.dispose()
        const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : []
        for (const material of materials) {
          for (const value of Object.values(material)) if (value?.isTexture) value.dispose()
          material.dispose()
        }
      })
    },
  }
}
