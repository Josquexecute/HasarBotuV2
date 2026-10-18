import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // DB'ye dokunan test dosyalari ayni test semasini sifirlar; sirali kosar.
    fileParallelism: false,
    // API importlari native PDF/canvas modullerini de yukler. Windows'ta threads
    // worker'i kapanirken testler gecse bile 0xC0000005 ile tum runner cokebilir.
    // Forks, native modullerin yasam dongusunu ayri Node surecinde tutar.
    pool: 'forks',
  },
})
