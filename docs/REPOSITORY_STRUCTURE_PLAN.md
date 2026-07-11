# HasarBotu V2 — Repository Yapısı Geçiş Planı

Tarih: 2026-07-11
Durum: Plan; mevcut UI taşınmamıştır
Başlangıç referansı: `v0.1.0-ui-baseline`

## 1. Mevcut repository denetimi

### 1.1 Yapı

Mevcut repository tek Vite uygulamasıdır:

```text
src/
  app/          BrowserRouter, uygulama kabuğu state'i
  components/   Sidebar, Topbar, ortak durum görünümleri
  features/     10 sayfa/özellik dosyası
  mocks/        cases ve çalışma alanı mock kayıtları
  styles/       token ve global dense UI stilleri
  test/         Vitest setup
  types/        UI'de kullanılan CaseRecord tipi
  utils/        normalize arama yardımcısı ve testi
```

- 28 `src` dosyası, 10 feature dosyası, 2 test dosyası vardır.
- Root package workspaces içermez.
- Build `tsc -b && vite build`; strict TypeScript açıktır.
- Test Vitest + jsdom + Testing Library ile çalışır.
- Routing `BrowserRouter` ve route bileşenleriyle tek uygulamadadır.
- Global state kütüphanesi yoktur; React component state'i kullanılır.
- Tema, yoğunluk ve menü durumu `localStorage`; aktif dosya sekmesi `sessionStorage` içindedir.
- Gerçek `fetch`, IPC, Electron, PostgreSQL veya dosya sistemi erişimi yoktur.

### 1.2 UI–veri bağımlılıkları

Mock sınırı bugün feature'ların içindedir:

- Dashboard, Cases ve Case Detail doğrudan `mocks/cases` içe aktarır.
- Closed Cases, Reports, Legislation, Notifications ve Management doğrudan `mocks/workspaces` içe aktarır.
- Filtreleme, sıralama ve özet hesaplarının bir bölümü sayfa bileşenlerindedir.
- `CaseRecord` UI tablosu ihtiyaçlarıyla domain alanlarını aynı arayüzde taşır.
- Mock mutation'lar (`useState`) API komutu yerine geçer.

Gerçek API geçişinde mock dizilerini bileşen içinde koşullu değiştirmek yerine repository/adapter sınırı kurulmalıdır:

```text
Feature UI → application query/command hook → DataPort
                                           ├── MockDataAdapter
                                           └── HttpApiAdapter
```

### 1.3 Baseline'ı bozabilecek riskler

- `CaseRecord` doğrudan API DTO yapılırsa UI için üretilmiş `followUpTone`, metinleştirilmiş tarih ve para alanları domain'e sızar.
- Loading/error state sonradan eklenirken mevcut yoğun tablo yüksekliği ve hızlı detay davranışı değişebilir.
- Route'lar masaüstü/web ayrımında çoğaltılırsa aktif sekme ve query parametreleri drift edebilir.
- Mock ve gerçek adapter aynı anda feature'a import edilirse test determinismi bozulur.
- Monorepo'ya tek seferde taşıma import, Vite asset, CSS ve test yollarını topluca kırabilir.
- Electron renderer'a Node yetkisi verilirse kabul edilmiş web güven sınırı bozulur.
- Shared package çıkarılırken global CSS yükleme sırası değişirse açık/koyu tema baseline'ı sapar.

## 2. Yapı seçenekleri

| Seçenek | Artılar | Eksiler | Değerlendirme |
| --- | --- | --- | --- |
| Mevcut repository içinde aşamalı monorepo | Tek tarihçe, atomik contract değişimi, UI baseline ile karşılaştırma kolay | Root script ve import geçişi dikkat ister | Önerilen yaklaşım |
| Ayrı repository'ler, ortak paketleri yayınlama | Ekip/dağıtım bağımsızlığı | Paket registry, sürüm drift'i, küçük ekipte operasyon yükü | İlk aşamada gereksiz |
| Tek uygulama içinde API/File Agent klasörleri | Başlangıç hızlı | Runtime/güven sınırı bulanık, bağımsız servis testi zor | Geçici iskelet dışında önerilmez |
| Baştan tam monorepo taşıması | Hedef yapı hemen görünür | Büyük geri dönüş maliyeti, kabul edilmiş UI için yüksek risk | Reddedilen geçiş biçimi |

## 3. Önerilen hedef yapı

npm workspaces, Paket 01 için kilitlenmiş workspace yöneticisidir. Nx, Turborepo, pnpm, Yarn veya başka bir monorepo aracı kullanılmaz.

```text
apps/
  web/                      # Kabul edilmiş React UI
  desktop/                  # İnce Electron shell ve güvenli preload

services/
  api/                      # Merkezi modüler monolit API
  file-agent/               # Tek fiziksel yazma/taşıma süreci

packages/
  domain/                   # Saf domain tipleri, durum makineleri, kurallar
  contracts/                # API DTO, error ve validation şemaları
  ui/                       # Paylaşılan görsel bileşen/tokenlar
  config/                   # Typed config ve environment şemaları
  testing/                  # Fixture builder, contract ve integration yardımcıları

docs/                       # Kilit kararlar, planlar, runbook ve kabul kanıtları
design/                     # Stitch yalnız referans
```

Kanonik workspace yolları `apps/web`, `apps/desktop`, `services/api`, `services/file-agent`, `packages/domain`, `packages/contracts`, `packages/ui`, `packages/config` ve `packages/testing` olarak adlandırılır. Aşağıdaki aşamalardaki **Geri dönüş** maddeleri, her aşamanın geri alma yöntemidir.

Bağımlılık yönü:

```text
apps/web ───────► packages/ui, contracts, domain
apps/desktop ───► apps/web build veya packages/ui, contracts
services/api ───► contracts, domain, config
services/file-agent ─► contracts, domain, config
packages/ui ────► contracts/domain'in yalnız sunum için gerekli salt-okunur tipleri
packages/domain ─X─► React, Node framework, PostgreSQL, Electron
packages/contracts ─X─► UI bileşeni veya database entity
```

## 4. Aşamalı ve geri alınabilir geçiş

Her aşama ayrı commit/PR ve yeşil kalite kapısı ister. Bu belge yalnız planlar; taşıma yapmaz.

### Aşama R1 — Workspace kabuğu

- **Durum:** Tamamlandı — 2026-07-11; root UI taşınmadan npm workspace desenleri ve `packages/config` eklendi.
- **Taşınacak dosyalar:** Yok. Root `src/` ve Vite uygulaması yerinde kalır.
- **Değişecek import yolları:** Yok.
- **Değişiklik:** Root `package.json` için `workspaces` iskeleti; boş/hello-package olmadan script delegasyonu planı; workspace tsconfig tabanı.
- **Risk:** npm script isimlerinin değişmesi; lockfile churn.
- **Doğrulama:** `npm install`, `npm ls --workspaces --depth=0`, mevcut `npm run typecheck`, `lint`, `test`, `build`, `audit`, `git diff --check` ve kısa UI smoke testi.
- **Geri dönüş:** Workspace alanlarını ve ek config dosyalarını kaldır; lockfile'ı aşama öncesi commit'e döndür.
- **Kabul:** Root UI komutları ve build byte/route davranışı korunur.

### Aşama R2 — `packages/domain` çıkarımı

- **Taşınacak dosyalar:** `src/types/case.ts` içindeki saf `CaseType`, temel status/stage türleri; UI-only `SortKey` yerinde kalır.
- **Değişecek import yolları:** `../types/case` → `@hasarbotu/domain` yalnız saf domain kullanan dosyalarda.
- **Risk:** UI sunum tiplerinin domain'e taşınması; circular dependency.
- **Doğrulama:** Domain unit test, TypeScript project reference, tüm UI testleri ve build.
- **Geri dönüş:** Paket export'larını kaldır, eski type dosyasını geri al, importları önceki hale getir.
- **Kabul:** Domain paketi React/DOM bağımlılığı taşımaz; iki dosya türü union'ı testlidir.

### Aşama R3 — `packages/contracts` ve adapter portları

- **Taşınacak dosyalar:** Yeni DTO/error/validation planları; mevcut mock veri taşınmaz.
- **Değişecek import yolları:** Feature bileşenleri doğrudan contracts import etmez; application hook/adapter kullanır.
- **Risk:** DTO ile domain/entity'nin karışması; mock şeklinin API sözleşmesine dönüşmesi.
- **Doğrulama:** Contract schema testleri, serialization snapshot, mock adapter contract testleri, UI regresyonu.
- **Geri dönüş:** Feature'ların mevcut mock importlarını geri aç; adapter klasörünü kaldır.
- **Kabul:** Aynı portu hem mock hem HTTP adapter uygulayabilir; UI hâlâ mock adapter ile aynı görünür.

### Aşama R4 — Mevcut UI'yi `apps/web` altına taşıma

- **Taşınacak dosyalar:** `src/`, `index.html`, `vite.config.ts`, UI tsconfig ve ilgili test config; root docs/design kalır.
- **Değişecek import yolları:** Göreli feature importları mümkün olduğunca korunur; domain/contracts paket importları workspace alias olur.
- **Risk:** CSS asset path, BrowserRouter base, Vitest setup, build output ve Electron gelecekteki asset yolu.
- **Doğrulama:** Root delegasyon scriptleri ile beş kalite kapısı; 1366×768/1920×1080 görsel karşılaştırma; route deep-link testi.
- **Geri dönüş:** Tek taşıma commit'ini revert; root build config'e dön.
- **Kabul:** UI acceptance raporundaki ekran/etkileşim sonuçları değişmez.

### Aşama R5 — `services/api` iskeleti

- **Taşınacak dosyalar:** Yok; yeni service oluşturulur.
- **Değişecek import yolları:** Yalnız API service kendi domain/contracts/config paketlerini kullanır.
- **Risk:** Framework seçilmeden scaffold; root script çatışması.
- **Doğrulama:** API typecheck/lint/unit, `/health/live`, process kapanış testi; UI kalite kapıları.
- **Geri dönüş:** Workspace ve service klasörünü kaldır; UI etkilenmez.
- **Kabul:** API health dışında iş endpoint'i yoktur; UI hâlâ mock adapter'dadır.

### Aşama R6 — `services/file-agent` iskeleti

- **Taşınacak dosyalar:** Yok; yeni worker service oluşturulur.
- **Değişecek import yolları:** File Agent yalnız domain/contracts/config ve job portlarını kullanır.
- **Risk:** Gerçek storage'a erken yazma; API ile sorumluluk çakışması.
- **Doğrulama:** Temp sandbox'ta path traversal/idempotency/retry testleri; gerçek `P:\` yazma yok.
- **Geri dönüş:** Service'i workspace'ten çıkar; database job tablosu migration'ı varsa ayrı geri alma migration'ı.
- **Kabul:** Agent varsayılan olarak dry-run/sandbox; kritik yazma etkin değildir.

### Aşama R7 — `packages/ui` çıkarımı

- **Taşınacak dosyalar:** Önce `styles/tokens.css` ve saf ortak buton/state bileşenleri; feature sayfaları taşınmaz.
- **Değişecek import yolları:** `src/components` → `@hasarbotu/ui` yalnız taşınan atomlarda.
- **Risk:** CSS sırası, theme root ve yoğunluk selector'larının bozulması.
- **Doğrulama:** Component test, visual baseline, her tema/çözünürlük, build CSS boyut karşılaştırması.
- **Geri dönüş:** Paket importlarını yerel dosyalara döndür ve UI paketini kaldır.
- **Kabul:** Pixel/overflow/klavye davranışı kabul baseline'ından sapmaz.

### Aşama R8 — `apps/desktop` ince kabuk

- **Taşınacak dosyalar:** UI taşınmaz; desktop main/preload/shell eklenir.
- **Değişecek import yolları:** Renderer aynı web bundle/contracts kullanır; Node modülü feature'a import edilmez.
- **Risk:** Node integration, geniş IPC, farklı router base, dosya yolu sızıntısı.
- **Doğrulama:** Context isolation testi, IPC allow-list, paketlenmemiş smoke test, web UI regresyonu.
- **Geri dönüş:** Desktop workspace'i çıkar; web uygulaması bağımsız çalışır.
- **Kabul:** Desktop kapanınca web/UI ve API değişmeden çalışır; IPC yalnız belgelenmiş dar eylemleri sunar.

## 5. Root script hedefi

İlk geçişte mevcut komutlar korunur:

- `npm run typecheck`
- `npm run lint`
- `npm run test`
- `npm run build`
- `npm audit --audit-level=moderate`

Workspace büyüdüğünde root komutlar aynı isimle tüm paketleri çalıştırır. Paket bazlı komutlar eklenebilir; kullanıcı ve CI sözleşmesi olan mevcut komutlar kaldırılmaz.

## 6. Mock sınırlarının aşamalı değiştirilmesi

1. `DataPort` arayüzleri contracts değil application katmanında tanımlanır.
2. Mevcut `mocks/` kayıtları `MockDataAdapter` arkasına alınır.
3. Feature'lar query/command hook kullanır; mock import etmez.
4. `HttpApiAdapter` aynı portu uygular ve contract şemasını doğrular.
5. Environment/config yalnız adapter seçer; feature içinde `if mock` bulunmaz.
6. Contract test aynı senaryoyu her iki adapter'a uygular.
7. Gerçek adapter ekran bazında açılır; tek seferde tüm UI geçirilmez.

## 7. Koruma kuralları

- Her taşıma öncesi `v0.1.0-ui-baseline` görsel/etkileşim kanıtı referans alınır.
- Route URL'leri ve Türkçe etiketler compatibility sözleşmesidir.
- Paket çıkarımı aynı anda UI yeniden tasarımı içermez.
- Framework/ORM/workspace aracı kararı olmadan dependency eklenmez.
- Rollback dosya kopyalama değil Git revert/feature flag ile yapılır.
- Main/tag değiştirilmez; mimari çalışmalar ayrı dal ve ayrı paketlerdedir.
