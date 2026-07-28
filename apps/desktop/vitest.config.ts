import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Gerçek Electron süreci başlatan e2e testi tek başına koşmalıdır; aynı
    // anda ikinci bir Chromium örneği açmak pencere/oturum sırasını bozar.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
})
