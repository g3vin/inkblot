import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Claude Code sets CLAUDECODE in its shell. There the per-asset table (about 200 lines
// on every build) is noise, so print only warnings and errors; a person still sees it.
const agent = Boolean(process.env.CLAUDECODE)

export default defineConfig({
  plugins: [react()],
  logLevel: agent ? 'warn' : 'info',
  build: { reportCompressedSize: false },
})
