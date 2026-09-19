<div align="center">

# 🚗 HasarBotu V2

**Trafik ve Kasko ekspertiz dosyalarını ihbardan kapanışa yöneten, masaüstü öncelikli operasyon uygulaması**

[![License: Proprietary](https://img.shields.io/badge/license-All%20Rights%20Reserved-red.svg)](./LICENSE)
[![Stack](https://img.shields.io/badge/stack-React%20%7C%20TypeScript%20%7C%20Fastify%20%7C%20PostgreSQL-blue.svg)](#-teknoloji-yığını)
[![Platform](https://img.shields.io/badge/platform-Windows-0078D6.svg)](#-masaüstü-paketi)

</div>

---

## 📋 Genel Bakış

HasarBotu V2, **Baran Global Ekspertiz** için geliştirilen; trafik ve kasko dosyalarının ihbar aşamasından kapanışa kadar tüm sürecini yöneten profesyonel bir operasyon uygulamasıdır. Dosya takibi, evrak/fotoğraf doğrulaması, işçilik hesaplaması, ağır hasar (PERT) değerlendirmesi, değer kaybı hesabı ve raporlama tek bir çatı altında toplanır.

Uygulama **yalnız iki dosya türünü** yönetir: **Trafik** ve **Kasko**. Değer Kaybı, Trafik dosyasında zorunlu, Kasko dosyasında isteğe bağlı bir modüldür — ayrı bir dosya türü değildir.

### Ana modüller

| Modül | Açıklama |
|---|---|
| **Durum Panosu** | Operasyonel özet ve uyarılar |
| **Dosyalar** | Kompakt, özelleştirilebilir dosya listesi ve hızlı detay paneli |
| **Dosya Detayı** | Özet, Operasyon, Evrak/Fotoğraf, İşçilik, Ağır Hasar, Değer Kaybı, Raporlar, E-postalar, Geçmiş sekmeleri |
| **Koşullu Evrak Kontrolü** | Dosya türüne göre otomatik zorunlu/opsiyonel evrak değerlendirmesi |
| **Zorunlu Kasko Kontrolü** | Kasko dosyalarında 7 zorunlu, kanıt tabanlı kontrol; tamamlanmadan kapanış engellenir |
| **AI İşçilik / Excel** | Föy analizi, kanıt tabanlı öneri, kullanıcı onaylı uygulama |
| **Ağır Hasar / PERT** | Kullanıcı kontrollü ekonomik değerlendirme |
| **Değer Kaybı** | Sürümlü, kanıtlı hesap ve rapor üretimi |
| **Mevzuat ve AI Yardımcısı** | Poliçe analizi, kanıt referanslı kural yorumlama |
| **Kapanan Dosyalar / Raporlar ve Ücretler** | Kapanış ücreti onayı ve raporlama |

### 🔒 AI güvenlik sınırı

AI bu uygulamada yalnız **karar desteği** sağlar. Dosya kapatma, klasör taşıma, Excel'e yazma, kapanma ücreti onayı, PERT/Değer Kaybı kesinleştirmesi gibi hiçbir kritik işlem kullanıcı onayı olmadan gerçekleşmez. Her AI sonucu mümkün olduğunda **sonuç + gerekçe + kaynak belge + sayfa + güven seviyesi** ile birlikte sunulur.

---

## 🏗️ Mimari

```
                    ┌─────────────────────┐
                    │   Electron Masaüstü  │   ← ince kabuk (loopback köprü)
                    │   (apps/desktop)      │
                    └──────────┬───────────┘
                               │ http(s)
                    ┌──────────▼───────────┐
                    │   Merkezi API         │   Fastify + PostgreSQL
                    │   (services/api)      │
                    └──────────┬───────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                                  ▼
    ┌───────────────────┐              ┌───────────────────┐
    │   PostgreSQL        │              │   File Agent        │
    │   (ana iş verisi)   │              │   (services/file-agent) │
    └───────────────────┘              │   kritik dosya/klasör  │
                                        │   işlemleri (Windows   │
                                        │   Service)             │
                                        └──────────┬────────────┘
                                                   ▼
                                        ┌───────────────────┐
                                        │   Yerel depolama    │
                                        │   PDF, Excel, foto  │
                                        └───────────────────┘
```

- **Veritabanı**: PostgreSQL tek doğruluk kaynağı; fiziksel dosyalara yalnız göreli yol tutulur.
- **Depolama**: aktif dosyalar yerel storage üzerindedir; pCloud yedek/arşiv içindir, canlı çalışma kökü değildir.
- **Dosya Agent**: kritik klasör taşıma/yeniden adlandırma işlemlerini plan → önizle → onay → uygula → doğrula → kesinleştir → audit modeliyle yürütür.
- **API**: kimlik doğrulama, RBAC (6 rol), audit trail, tüm iş kuralları.
- **Masaüstü**: iş mantığı taşımayan ince Electron kabuğu; tek origin, sıkı CSP, sandbox açık.

Ayrıntılı mimari kararları için `docs/ARCHITECTURE.md` ve `docs/DECISION_LOG.md`.

---

## 🧰 Teknoloji Yığını

| Katman | Teknoloji |
|---|---|
| Frontend | React, TypeScript (strict), Vite |
| API | Fastify, Zod (sözleşme tabanlı doğrulama) |
| Veritabanı | PostgreSQL, `node-pg-migrate` |
| Masaüstü | Electron (ince kabuk, kod imzasız gelişim sürümü) |
| Dosya İşlemleri | Windows Service (WinSW), fail-closed hash/audit zinciri |
| Test | Vitest, gerçek PostgreSQL entegrasyon testleri |
| Paketleme | `electron-builder` (NSIS installer) |

---

## 📦 Depo Yapısı

```
HasarBotuV2/
├── src/                      # React/Vite frontend (repo kökünde, geçici)
├── apps/
│   └── desktop/               # Electron masaüstü kabuğu + NSIS installer
├── services/
│   ├── api/                   # Merkezi Fastify API
│   └── file-agent/            # Kritik dosya/klasör operasyon servisi
├── packages/
│   ├── domain/                 # Saf domain kuralları (bağımlılıksız)
│   ├── contracts/              # Zod DTO/route sözleşmeleri
│   ├── database/                # Migration'lar + DB yardımcıları
│   ├── desktop-bridge/          # Masaüstü loopback köprüsü
│   └── config/                  # Ortak TypeScript yapılandırması
├── deploy/windows-service/    # WinSW dağıtım/operasyon araçları
└── docs/                      # Mimari, karar günlüğü, ürün gereksinimleri
```

---

## 🚀 Geliştirme

Node.js **24.x** gerekir (`>=24 <25`). Kilit dosyasını korumak için temiz
kurulumda `npm ci` kullanılır. Bu bilgisayarın hazırlığı ve test aşamasına
geçiş için [yerel geliştirme kılavuzuna](./docs/LOCAL_DEVELOPMENT.md) bakın.

```bash
# Bağımlılıkları kur (workspace paketlerini de derler)
npm ci

# Frontend geliştirme sunucusu
npm run dev

# Tam kalite kapısı: typecheck + lint + test + build
npm run typecheck
npm run lint
npm test
npm run build
```

PostgreSQL, gerçek entegrasyon testleri için `TEST_DATABASE_URL` ortam değişkeni bekler (yalnız `_test` ile biten veritabanı adları kabul edilir — güvenlik kapısı).

### 🖥️ Masaüstü Paketi

```bash
npm run build
cd apps/desktop
npm run package:win
```

`apps/desktop/release/HasarBotu-Setup-<sürüm>.exe` çıktısı üretilir (imzasız, NSIS, kullanıcı bazlı kurulum).

---

## 📄 Lisans

Bu yazılım **Baran Global Ekspertiz**'in özel mülkiyetindedir. Tüm hakları saklıdır. Ayrıntılar için [`LICENSE`](./LICENSE) dosyasına bakın.

<div align="center">

**© 2026 Baran Global Ekspertiz** — Tüm hakları saklıdır.

</div>
