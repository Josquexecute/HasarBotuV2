import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // DB'ye dokunan test dosyalari ayni test semasini sifirlar; sirali kosar.
    fileParallelism: false,
    // Windows'ta API test worker'i icinden gercek PDF parser worker'i acildiginda
    // forks havuzu surec sinirinda kararsizlasabiliyor; threads ayni izolasyonu
    // korurken ic ice worker testini deterministik tamamliyor.
    pool: 'threads',
  },
})
