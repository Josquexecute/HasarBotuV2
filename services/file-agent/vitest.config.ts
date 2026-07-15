import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // PDF/OCR testleri gercek worker_threads aciyor. Windows'ta Vitest forks
    // havuzu uzun root kosusunda worker surecini kararsiz kapatabildigi icin
    // test izolasyonunu threads havuzuyla deterministik tutuyoruz.
    pool: 'threads',
  },
})
