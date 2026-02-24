import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      // mainnet-js needs these browser polyfills
      include: ['buffer', 'process', 'util', 'stream'],
      globals: { Buffer: true, process: true },
    }),
  ],
  worker: {
    // Use ES module format for workers so top-level await is supported
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['onnxruntime-node', '@xenova/transformers', 'agentic-flow', 'better-sqlite3'],
    include: ['mainnet-js'],
  },
  build: {
    rollupOptions: {
      external: ['onnxruntime-node', 'better-sqlite3', 'agentic-flow'],
    },
    target: 'esnext',
  },
  define: {
    global: 'globalThis',
  },
})
