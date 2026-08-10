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
                                        │   pCloud / P:\      │
                                        │   PDF, Excel, foto   │
                                        └───────────────────┘
```

- **Veritabanı**: PostgreSQL tek doğruluk kaynağı; fiziksel dosyalara yalnız göreli yol tutulur.
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

```bash
# Bağımlılıkları kur (workspace paketlerini de derler)
npm install

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

## 📊 Durum

Proje aktif geliştirme aşamasındadır. Güncel ilerleme, kilitlenmiş kararlar ve açık riskler için:

- [`docs/PROJECT_STATUS.md`](./docs/PROJECT_STATUS.md) — güncel durum
- [`docs/DECISION_LOG.md`](./docs/DECISION_LOG.md) — kalıcı kararlar ve gerekçeleri
- [`docs/ROADMAP.md`](./docs/ROADMAP.md) — yol haritası

---

## 🤖 Yapay Zekâ Geliştirme Araçları için Yönetişim

Bu depo, Codex, Claude Code, Gemini CLI, GitHub Copilot, Cursor, Windsurf ve benzeri AI kodlama araçlarının **aynı ürün kurallarına** göre çalışmasını sağlayacak şekilde yapılandırılmıştır.

**Talimat önceliği:**

1. `AGENTS.md`
2. `docs/DECISIONS.md`
3. `docs/PRODUCT_REQUIREMENTS.md`
4. `docs/DOMAIN_RULES.md`
5. `docs/ARCHITECTURE.md`
6. `docs/UI_SPEC.md`
7. `docs/SECURITY_AND_AI_POLICY.md`
8. `docs/TESTING_AND_ACCEPTANCE.md`
9. Göreve özel kullanıcı talimatı
10. Araç özel köprü dosyaları

Çelişki varsa tahmin yürütülmez; değişiklik yapılmadan önce kullanıcıya bildirilir.

**Araç köprüleri:**

| Araç | Köprü dosyası |
|---|---|
| Codex ve genel ajanlar | `AGENTS.md` |
| Claude Code | `CLAUDE.md` |
| Gemini CLI | `GEMINI.md` |
| GitHub Copilot | `.github/copilot-instructions.md` |
| Cursor | `.cursor/rules/hasarbotu-v2.mdc` |
| Windsurf | `.windsurfrules` |

Bu köprü dosyaları ana kuralları tekrar tanımlamaz; `AGENTS.md` ve `docs/` altındaki belgeleri kaynak kabul eder.

---

## 📄 Lisans

Bu yazılım **Baran Global Ekspertiz**'in özel mülkiyetindedir. Tüm hakları saklıdır. Ayrıntılar için [`LICENSE`](./LICENSE) dosyasına bakın.

<div align="center">

**© 2026 Baran Global Ekspertiz** — Tüm hakları saklıdır.

</div>
