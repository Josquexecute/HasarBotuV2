import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

/**
 * React Compiler kural adaptasyonu (HB-2026-090):
 *
 * `eslint-plugin-react-hooks` v7'nin getirdigi 14 Compiler kuralindan 13'u
 * upstream `recommended` seviyesinde calisir (11 tanesi `error`,
 * `incompatible-library` ve `unsupported-syntax` upstream'in kasitli tercihiyle
 * `warn`). Bu 13 kuralda ihlal YOKTUR ve seviyeleri burada override EDILMEZ.
 *
 * Geriye yalniz `set-state-in-effect` kalir. 33 bulgusunun tamami tek tek
 * incelendi; hicbiri davranissal kusur degildir:
 *
 *  - 23 bulgu: async yukleme oncesi durum sifirlama (`src/data/*` ve modul
 *    `load()` efektleri). Senkron sifirlama kaldirilirsa yeni anahtar icin
 *    ESKI veri gosterilir; bu daha kotu bir kusurdur. Butun adapter kimlikleri
 *    `useMemo`/`useState` ile kararlidir (sonsuz yeniden istek yok) ve her
 *    fetch `cancelled` muhafazasi tasir (yaris durumu yok).
 *  - 5 bulgu: anahtar degisiminde fail-closed sifirlama (onay bayraklari, form
 *    durumu, yerel override). Kasitli guvenlik davranisidir.
 *  - 3 bulgu: yeni gelen secenek listesine karsi secim mutabakati; hepsi
 *    yakinsayan fonksiyonel guncellemedir.
 *  - 2 bulgu: saat okumasi ve fetch sonrasi sayfa kelepcelemesi. `Date.now()`
 *    render'a tasinamaz; tasinirsa `react-hooks/purity` ihlal edilir.
 *
 * Bunlarin render sirasinda turetilmesi veri katmaninin state seklinin
 * yeniden kurulmasini gerektirir; ayri bir paket konusudur. Kural KAPATILMAZ,
 * `warn` seviyesinde acik kalir. Ayrinti: docs/DECISION_LOG.md HB-2026-090.
 */
const REACT_COMPILER_RULES_PENDING_ADOPTION = [
  'react-hooks/set-state-in-effect',
]

export default tseslint.config(
  { ignores: ['dist', 'coverage'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...Object.fromEntries(REACT_COMPILER_RULES_PENDING_ADOPTION.map((rule) => [rule, 'warn'])),
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
)
