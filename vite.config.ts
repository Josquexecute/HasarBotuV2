import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // HttpApiAdapter ayni-origin calissin diye dev proxy'si (yalniz gelistirme;
    // oturum cerezi SameSite=Strict ile sorunsuz tasinir). UI davranisi degismez.
    proxy: {
      '/api': 'http://127.0.0.1:3100',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
    globals: true,
  },
})
