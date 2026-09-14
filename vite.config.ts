import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Generated installers and local PostgreSQL/tooling files are not UI source.
    // Watching them can lock Electron DLLs during packaging on Windows.
    watch: { ignored: ['**/release/**', '**/.local/**'] },
    // HttpApiAdapter ayni-origin calissin diye dev proxy'si (yalniz gelistirme;
    // oturum cerezi SameSite=Strict ile sorunsuz tasinir). UI davranisi degismez.
    proxy: {
      '/api': 'http://127.0.0.1:3100',
    },
  },
  test: {
    // Workspace suites run separately. Local checkouts/backups must not be collected.
    include: configDefaults.include.map((pattern) => `src/${pattern}`),
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
    globals: true,
    // Test dosyaları ortak jsdom global'inde fetch/localStorage ve cleanup
    // kullandığı için dosya-paralel koşu açık render'ları kesebiliyor.
    fileParallelism: false,
  },
})
