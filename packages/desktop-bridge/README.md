# `@hasarbotu/desktop-bridge`

Masaüstü kabuğunun **loopback aynı-origin köprüsü**. Electron'a bağımlı
değildir; yalnız Node yerleşik modüllerini kullanır ve tek başına test edilir.
`apps/desktop` (D2) bu paketi main process'ten çağıracaktır.

## Neden var

Renderer `file://` veya özel bir şemadan API'ye giderse istek **cross-origin**
olur. O durumda:

- `SameSite=Strict` oturum çerezi (`hb_session`) gönderilmez, ve
- API'de CORS yoktur, dolayısıyla istek zaten reddedilir.

Köprü, renderer'ın gördüğü origin sayısını **bire** indirir: aynı `host:port`
hem UI build çıktısını hem `/api/*` isteklerini karşılar. `/api/*` sunucu-sunucu
API origin'ine iletilir ve tarayıcı API origin'ini hiç görmez. Bu, bugün Vite
dev proxy'sinin (`vite.config.ts`) sağladığı davranışın üretimdeki karşılığıdır.

Karar ve gerekçe: `docs/DECISION_LOG.md` → HB-2026-103.

## Sınırlar

- Runtime dependency yoktur; Electron import edilmez.
- **İş mantığı içermez.** Yalnız taşımadır (ADR-Q06 "ince kabuk"). Kabukta iş
  mantığı biriktiği anda geri alma stratejisi ("desktop paketini kaldır, web'i
  kullan") geçersizleşir.
- Yalnız `127.0.0.1`'e bind edilir; dışarıdan erişilebilir port açılmaz.
- `Host` başlığı loopback değilse istek reddedilir (DNS rebinding).
- `set-cookie` **değiştirilmeden** aktarılır; hiçbir yönde CORS başlığı
  üretilmez; kimlik uydurulmaz (çerezsiz istek 401 kalır).
- Varlık yolları traversal/sürücü/ters bölü/kontrol karakterine karşı
  doğrulanır ve birleştirmeden sonra kök altında olduğu yeniden denetlenir.
- API erişilemezken sahte başarı üretilmez; `502` döner ve ham hata metni
  istemciye taşınmaz.

## Kullanım

```ts
import { startDesktopBridge } from '@hasarbotu/desktop-bridge'

const bridge = await startDesktopBridge({
  apiOrigin: 'http://127.0.0.1:3100',
  assetRoot: '/path/to/ui/dist',
})
// Renderer YALNIZ bu origin'i yükler:
await window.loadURL(bridge.origin)
```

## Açık nokta

`cookieSecure` üretim masaüstü kurulumunda hangi değeri alacak? Köprü düz HTTP
loopback'tir; Chromium `http://127.0.0.1`'i güvenli bağlam sayar, ancak kesin
seçim (düz loopback HTTP mi, köprüde TLS sonlandırma mı) D2/Paket 22 dağıtım
kararıdır.
