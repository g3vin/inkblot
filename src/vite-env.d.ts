/// <reference types="vite/client" />

/* Gives TypeScript the ambient module declarations Vite relies on: `*.css` side-effect
   imports, `?raw` and `?url` suffixed imports, and `import.meta.env`. Without this,
   a .ts file importing a stylesheet fails to resolve. */
