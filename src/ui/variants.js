/**
 * variants.js — where the design review's prototypes plug in (docs/design-review).
 *
 * In development, `?variant=<family>:<picks>` loads `src/dev/variants/`, which fills
 * this object; a primitive that has a prototype checks it behind `import.meta.env?.DEV`,
 * so production builds never read it and never contain the prototypes. With no
 * `?variant`, it stays empty and every primitive renders as it always has.
 */
export const variants = {}
