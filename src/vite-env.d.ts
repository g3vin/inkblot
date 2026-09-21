/// <reference types="vite/client" />

/* Gives TypeScript the ambient module declarations Vite relies on: `*.css` side-effect
   imports, `?raw` and `?url` suffixed imports, and `import.meta.env`. Without this,
   a converted file importing its own stylesheet fails to resolve. */
