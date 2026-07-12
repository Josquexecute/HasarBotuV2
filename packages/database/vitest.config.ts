import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Entegrasyon testleri paylasilan test veritabanini sifirladigi icin sirali kosar.
    fileParallelism: false,
  },
})
