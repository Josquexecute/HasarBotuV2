import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

/**
 * ESLint 10 uyumu icin zorunlu olan `eslint-plugin-react-hooks` v5 -> v7
 * yukseltmesi, `recommended` setine 14 yeni React Compiler kurali ekler
 * (v5'te yalniz `rules-of-hooks` ve `exhaustive-deps` vardi).
 *
 * Bu paketin kapsami ESLint 10 gecisidir. Paket oncesi lint sozlesmesi birebir
 * korunur: `rules-of-hooks` error, `exhaustive-deps` warn. Yeni Compiler
 * kurallari KAPATILMAZ; `warn` seviyesinde acik birakilir; boylece bulgular
 * gorunur kalir ve yeni ihlaller aninda raporlanir, ancak veri katmaninin
 * yeniden yapilandirilmasini gerektiren mevcut bulgular bu paketi bloke etmez.
 *
 * Bu kurallarin `error` seviyesine cikarilmasi ve mevcut bulgularin giderilmesi
 * ayri "React Compiler kural adaptasyonu" paketidir; bkz.
 * docs/IMPLEMENTATION_PLAN.md ve DECISION_LOG HB-2026-089.
 */
const REACT_COMPILER_RULES_PENDING_ADOPTION = [
  'react-hooks/config',
  'react-hooks/error-boundaries',
  'react-hooks/gating',
  'react-hooks/globals',
  'react-hooks/immutability',
  'react-hooks/incompatible-library',
  'react-hooks/preserve-manual-memoization',
  'react-hooks/purity',
  'react-hooks/refs',
  'react-hooks/set-state-in-effect',
  'react-hooks/set-state-in-render',
  'react-hooks/static-components',
  'react-hooks/unsupported-syntax',
  'react-hooks/use-memo',
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
