/**
 * lodash is CommonJS. Vite rewrites `import { debounce } from 'lodash'` into a
 * default-import + property access; Node's ESM/CJS interop cannot, because lodash
 * builds its exports dynamically. So load the real module through createRequire and
 * re-export what the canvas uses — this is the genuine lodash, not a fake.
 */
import { createRequire } from 'node:module'

const lodash = createRequire(import.meta.url)('lodash')

export const debounce = lodash.debounce
export const throttle = lodash.throttle
export default lodash
