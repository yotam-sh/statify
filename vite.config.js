import { defineConfig } from 'vite'

export default defineConfig({
  // index.html lives in the project root
  root: '.',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // Proxy API calls to the FastAPI backend during dev
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
