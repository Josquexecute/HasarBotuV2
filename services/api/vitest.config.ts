import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // DB'ye dokunan test dosyalari ayni test semasini sifirlar; sirali kosar.
    fileParallelism: false,
  },
})
