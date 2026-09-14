import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

/**
 * React Compiler kurallari (HB-2026-090, HB-2026-096):
 *
 * `eslint-plugin-react-hooks` v7'nin getirdigi 14 Compiler kuralinin TAMAMI
 * artik upstream `recommended` seviyesinde calisir; hicbiri global olarak
 * override EDILMEZ. `set-state-in-effect` de dahil olmak uzere kurallar
 * `error` seviyesindedir (`incompatible-library` ve `unsupported-syntax`
 * upstream'in kasitli tercihiyle `warn`).
 *
 * Asagidaki iki dosya, tek tek kanitlanmis ve baska turlu cozulemeyen iki
 * bulgu icin `warn` seviyesinde birakilir. Bunlar kural gevsetmesi degil,
 * kapsami dosya ve gerekce ile sinirlanmis istisnalardir; kodda
 * `eslint-disable` yorumu kullanilmaz.
 */
const SET_STATE_IN_EFFECT_EXCEPTIONS = [
  // LaborAllocationAiModule: gecen sure sayaci. Deger `Date.now()` ile olculur;
  // render'a tasinirsa `react-hooks/purity` ihlal edilir. Ilk olcum efektte
  // senkron yazilmazsa sayac bir saniye boyunca yanlis deger gosterir.
  'src/features/cases/LaborAllocationAiModule.tsx',
  // CasesPage: fetch sonrasi sayfa kelepcelemesi. `totalPages` ancak yanit
  // geldikten sonra bilinir. Render'da turetmek, istenen sayfayi kalici olarak
  // duzeltmedigi icin toplam sayfa sayisi yeniden buyudugunde kullaniciyi
  // beklenmedik bir sayfaya siciratirdi; pagination davranisi korunur.
  'src/features/cases/CasesPage.tsx',
]

export default tseslint.config(
  // Flat config'de global ignore deseni config dosyasinin dizinine goredir:
  // yalin `dist` YALNIZ kok `dist/`i disliyor, workspace `dist` klasorlerini
  // disarida birakmiyordu. `**/dist/**` her seviyedeki uretilmis ciktiyi kapsar.
  // Kaynak dosya kapsami degismez; yalniz build ciktisi lint disi kalir.
  // Yerel araç/yedekler ve installer çıktısı kaynak değildir; yedekteki
  // eslint.config.js de ikinci bir TypeScript config kökü oluşturmamalıdır.
  { ignores: ['**/dist/**', '**/coverage/**', '**/release/**', '.local/**'] },
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
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    files: SET_STATE_IN_EFFECT_EXCEPTIONS,
    rules: { 'react-hooks/set-state-in-effect': 'warn' },
  },
)
