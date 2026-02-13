import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'onnxruntime-web/ort-wasm': path.resolve(
        __dirname,
        'node_modules/onnxruntime-web/dist/ort.wasm.min.mjs'
      )
    }
  },
  optimizeDeps: {
    include: ['@tauri-apps/api/tauri'],
    exclude: ['onnxruntime-web/ort-wasm']
  }
})