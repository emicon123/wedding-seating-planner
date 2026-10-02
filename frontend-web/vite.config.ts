import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Everything lives under /wesele (ADR-001 §3): assets, router and API.
const BASE_PATH = '/wesele/'
const API_PROXY = {
  '/wesele/api': { target: 'http://localhost:8080', changeOrigin: false },
}

export default defineConfig({
  base: BASE_PATH,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  server: { proxy: API_PROXY },
  preview: { proxy: API_PROXY },
  test: {
    environment: 'jsdom',
    // a made-up origin, so a test that forgets its mock can never reach a real server on this host
    environmentOptions: { jsdom: { url: 'http://stoliki.test/wesele/' } },
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
