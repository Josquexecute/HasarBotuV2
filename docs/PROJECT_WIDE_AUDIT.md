# HasarBotu V2 — Proje Çapında Denetim ve Sertleştirme Raporu

Tarih: 2026-07-11
Dal: `hardening/project-wide-audit` (taban: `36a140c`, Paket 03)
Kapsam: Domain, contracts, workspace/build, test, güvenlik, dokümantasyon, Git sınırları ve UI baseline doğrulaması. Backend, PostgreSQL, Electron ve gerçek entegrasyonlar kapsam dışıdır.

## 1. Denetlenen alanlar

- Git: dallar, commit zinciri, tag bütünlüğü, ignore kuralları, remote yokluğu
- Workspace: exports yönleri, ESM/CJS sınırı, temiz kurulum yeniden üretilebilirliği
- `packages/domain`: invariant'lar, tarih/timezone semantiği, kimlik politikası, null/undefined sınırı, test kapsamı
- `packages/contracts`: strict/coercion davranışı, DTO-domain ayrımı, mapper round-trip, hata sızıntısı, pagination/query sınırları, JSON Schema paritesi, package exports
- UI (`src`): davranış değiştirilmeden UAT kabul davranışları, tema, arama, hızlı detay, Escape, 1366×768, konsol
- Güvenlik: raw input sızıntısı, prototype pollution, path traversal, ReDoS, aşırı uzun girdi, dependency zinciri

## 2. Bulgular ve durumları

### Yüksek

| # | Bulgu | Kanıt | Durum |
|---|---|---|---|
| Y1 | `followUpAt` (UtcDateTime) ürün semantiğiyle çelişiyordu; takip günlük tarihtir | HB-2026-005 ürün kararı; UI mocklarında takip görüntüsü gün bazlı | **Düzeltildi** — domain `followUpDate?: LocalDate`; wire `followUpDate: string|null` (LocalDate); query `followUpFrom/To` LocalDate; timezone dönüşümü yok |
| Y2 | Yayımlanan JSON Schema, runtime Zod doğrulamasından sessizce gevşekti (yıl alt sınırı, takvim, plaka, ID) | Önceki turda kanıtlandı: şema `1999/1` ve `2026-02-30T...Z` kabul ediyordu | **Düzeltildi** — ifade edilebilir kurallar pattern/min/max olarak şemaya taşındı; runtime-only kurallar `x-hasarbotu-runtime-validation` ile işaretlendi; README "JSON Schema güvenlik sınırı değildir" kaydı |

### Orta

| # | Bulgu | Kanıt | Durum |
|---|---|---|---|
| O1 | Kimlikler sınırsızdı: 2 MB veya `../../etc/passwd` kabul ediliyordu | Güvenlik incelemesi probu | **Düzeltildi** — domain + wire: 1..128, güvenli ASCII, `/`, ters bölü, `..`, kontrol karakteri reddi |
| O2 | Referans numaraları sınırsızdı; kontrol karakteri/backslash kabul ediyordu | Aynı prob | **Düzeltildi** — max 128, kontrol/backslash reddi, en az bir alfasayısal; `11/18882475` desteklenir; "path olarak kullanılamaz" belgelendi |
| O3 | `page` üst sınırsızdı (derin OFFSET kötüye kullanımı) | `page=9e15` kabul kanıtı | **Düzeltildi** — `page` 1..10.000 |
| O4 | Root `typecheck`/`test` mevcut `dist` artıklarına güveniyordu | dist silinince `ERR_MODULE_NOT_FOUND` | **Düzeltildi** — domain build bağımlı adımlardan önce; `build:packages` ile sıra tekilleştirildi; dist silinmiş halde tüm kapılar exit 0 kanıtlandı |
| O5 | JSON Schema çıktısı için regresyon kanıtı yoktu (Zod güncellemesi sessiz kayma riski) | Yalnız run-içi determinizm testi vardı | **Düzeltildi** — golden fixture'lar `test/fixtures/json-schema` altında commit'li; semantik karşılaştırma testi; güncelleme yalnız açık `schema:fixtures` script'iyle |

### Düşük

| # | Bulgu | Kanıt | Durum |
|---|---|---|---|
| D1 | `zod: ^4.0.0` caret aralığı tedarik zinciri/şema kayması riski | package.json | **Düzeltildi** — tam `4.4.3` pin; lockfile doğrulandı |
| D2 | `unrecognized_keys` hatası alan adını raporlamıyordu (`path: ""`) | Verify bulgusu | **Düzeltildi** — anahtar ADLARI (değer asla değil) en çok 10 adet, 64 karaktere kırpılmış, kontrol karakterleri temizlenmiş olarak raporlanır |
| D3 | Plaka uzunluk sınırı yoktu | İnceleme | **Düzeltildi** — max 32; kanonik/arama anahtarı davranışı korundu |
| D4 | `prepare` JSON Schema üretmiyor; artefakt sözleşmesi belirsizdi | Verify bulgusu | **Düzeltildi (belgeleme)** — README "Artefaktlar: ne zaman ne üretilir" bölümü; şema üretimi bilinçli olarak ayrı komuttur |

### Yanlış pozitifler / işlem gerekmeyenler

- **Mapper'ların beklenmeyen property taşıması:** Yok — mapper'lar sabit şekilli obje kurar (`...spread` yok); test ve inceleme doğruladı.
- **ReDoS:** Tüm desenler lineer; 2 MB girdi ~1 ms'te reddedildi (artık uzunluk sınırıyla ayrıca kesilir).
- **Prototype pollution:** `__proto__`/`constructor` bilinmeyen anahtar olarak reddedilir; hata raporunda yalnız dizi elemanı string değeri olarak taşınır; `Object.prototype` kirlenmediği testle kanıtlıdır.
- **CJS require sınırı:** ESM-only exports bilinçli tasarımdır; Node 24 `require()` düzgün `ERR_PACKAGE_PATH_NOT_EXPORTED` verir.

## 3. UI baseline doğrulaması (davranış değiştirilmedi)

- HTTP 200; başlık `HasarBotu V2`; 8 ana navigasyon; `UI Prototip · Mock Veri` etiketi görünür.
- 1366×768: yatay taşma yok (açık ve koyu temada ayrı doğrulandı).
- Üst arama `34mpa764` + Enter → `/dosyalar?q=34mpa764` → tek satır `34 MPA 764` (UAT-ISSUE-001/002 davranışı korunuyor).
- Satır tıklama → Hızlı Bakış paneli; **Escape** panelini kapatır.
- Tema değişimi çalışır ve `hasarbotu-theme` localStorage anahtarına persist eder.
- Konsol: yalnız Vite debug + React DevTools info; warning/error yok.
- `src` altında hiçbir dosya değiştirilmedi.

## 4. Kalite kapıları (gerçek sonuçlar, exit code)

| Kapı | Sonuç |
|---|---|
| `npm ci` (temiz worktree, node_modules+dist yok) | exit 0 |
| `npm run typecheck` (root; ayrıca dist silinmiş halde) | exit 0 / exit 0 |
| `npm run lint` | exit 0 |
| `npm run test` (root; ayrıca dist silinmiş halde) | exit 0 — **26 UI + 257 domain + 67 contracts = 350/350** |
| `npm run build` (root; ayrıca dist silinmiş halde) | exit 0 |
| `npm audit --audit-level=moderate` | exit 0 — 0 açık |
| `git diff --check` | exit 0 (yalnız CRLF bilgi uyarıları) |
| contracts `schema` (dist silinmiş halde self-contained) | exit 0 — 6 dosya |
| Golden JSON Schema testleri | geçti (67 contracts testine dahil) |
| Paket-adı import smoke (temiz worktree) | geçti — query/id/health/mapper exportları |
| UI HTTP 200 + konsol + 1366×768 | geçti; smoke sonrası 4173 portu kapatıldı |

Temiz-checkout doğrulaması ana çalışma ağacının dışında, `f3081ee` commit'inden açılan geçici detached worktree'de yapıldı ve worktree kaldırıldı; ana ağaçtaki izlenen dosyalar silinmedi.

## 5. Bilinçli ertelenenler ve kalan karar noktaları

- **Case ID biçimi** UUID/ULID'e kilitlenmedi (açık ürün kararı; HB-2026-005).
- **OpenAPI üretimi**, version taşıma yöntemi (`If-Match`/body), idempotency uygulaması ve auth → Paket 04+.
- **`fieldErrors` toplam sayısı** için genel üst sınır (şu an yalnız unknown-keys 10 ile sınırlı) → Paket 04 hata katmanında değerlendirilebilir; karar gerekli değil, iyileştirme adayı.
- **UI'nin domain/contracts tüketimi** — UI hâlâ mock modellerini kullanır; adapter geçişi ayrı pakettir.
- **Workspace komutlarının tek başına çalışması** domain dist'ine bağlıdır; root komutlar sırayı garanti eder (README'de belgeli). Daha derin çözüm (ör. TS project references) istenirse ayrı karar gerektirir.

## 6. Paket 04'e geçiş engelleri

Bilinen engel kalmadı: takip tarihi semantiği netleşti, sözleşme sınırları sertleşti, şema regresyon kanıtı ve temiz-checkout yeniden üretilebilirliği kuruldu. Paket 04 (API iskeleti ve sağlık uçları) `@hasarbotu/contracts`'ı doğrudan tüketebilir.
