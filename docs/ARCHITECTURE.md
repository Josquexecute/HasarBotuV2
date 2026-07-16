# HasarBotu V2 — Teknik Mimari

## Hedef yapı

```text
Windows Uygulaması / Web Arayüzü
            │
            ▼
        Merkezi API
            │
            ▼
        PostgreSQL
            │
            ├── Notlar
            ├── Görevler
            ├── Durumlar
            ├── AI Sonuçları
            ├── Audit Log
            └── Kural Sürümleri

Her Windows Cihazı
            │
            ▼
    Yerel pCloud Kökü
            │
            └── PDF / Excel / Fotoğraflar

Ana Dosya Agent
            │
            ▼
Kritik klasör taşıma / yeniden adlandırma
```

## Önerilen repository yapısı

```text
apps/
  desktop/
  web/
  api/
  file-agent/

packages/
  ui/
  domain/
  database/
  rules/
  ai/
  shared/
```

UI prototip aşamasında daha hafif yapı kullanılabilir:

```text
src/
  app/
  components/
  features/
  mocks/
  routes/
  styles/
  types/
```

## Kaynak doğruluk

- PostgreSQL: iş verisi
- pCloud: fiziksel dosyalar
- Göreceli yol: veritabanındaki dosya referansı
- `caseId`: vaka ana kimliği
- Plaka: arama/eşleştirme alanı

## Eşzamanlılık

Gerçek zamanlı ortak belge düzenleme hedeflenmez.

Koruma:

- Optimistic concurrency
- `updatedAt` veya row version
- Excel işlem kilidi
- Klasör işlem kilidi
- Idempotent kritik komutlar

## Backend ilkeleri

- Modüler monolit ile başla.
- Erken mikroservis kullanma.
- Domain kuralları API controller veya UI component içine gömülmez.
- Dosya Agent ayrı süreçtir.
- AI sağlayıcısı adapter arayüzü arkasında olmalıdır.
- Sigorta şirketi şablonları yapılandırılabilir olmalıdır.

## Frontend yükleme sınırı

- Uygulama kabuğu ve sık kullanılan liste/navigasyon akışları başlangıç bundle’ında kalır.
- Dosya Detayı route’u ve yüksek maliyetli gerçek API sekmeleri `React.lazy`/dinamik import sınırlarıyla ayrı chunk’lardır.
- Lazy route ve modüller mevcut `Suspense` ile loading, merkezi `ErrorBoundary` ile güvenli hata davranışını korur.
- Production build başlangıç JS grafiği ile her tekil chunk’ı 500.000 baytın altında doğrular; beklenen lazy modüllerin başlangıç preload’una dönmesi build regresyonudur.
- Code-splitting yalnız renderer yükleme davranışını değiştirir; DataPort, API, database, IPC ve fiziksel veri yazma sınırlarını değiştirmez.

## Depolama taşınabilirliği

Fiziksel dosyalar şimdilik pCloud/`P:\` yapısında kalır; `storageRootKey + relativePath` modeli sayesinde depolama kökü ileride başka disk, sunucu veya NAS'a taşınabilir. pCloud canlı veritabanı olarak kullanılmaz; ortak SQLite dosyası pCloud'a konmaz.

## Depolama profili

Örnek:

```text
Ana kök: P:\BARAN GLOBAL EKSPERTİZ
Yıl: 2026
Ay: Temmuz 2026
Kapalı klasör kalıbı: KAPALI {AY} {YIL}
```

Her cihaz farklı yerel pCloud kökü seçebilir.

## Yedek

Bağımsız ikinci kopya: 7/24 bağlı, BitLocker veya eşdeğer yöntemle şifrelenmiş harici disk (ana yol haritası 2026-07-12 kararı; sürekli bağlı diskin fidye yazılımı riski için periyodik çevrimdışı/immutable rotasyon açık öneridir).

Plan: günlük yedek, haftalık tam yedek, aylık arşiv. Saklama: 14 günlük, 8 haftalık, 12 aylık.

Yedeklenecekler: PostgreSQL, sistem ayarları, mevzuat paketleri, kural sürümleri, AI öğrenme kayıtları, audit log ve **pCloud/P:\ fiziksel dosya deposu** (önceki "fiziksel klasörler yedek dışıdır" hükmü geçersizdir).

- pCloud eşitlemesi tek başına yedek değildir; aylık arşivin pCloud'a kopyası yalnız ek kopyadır.
- Yedek dosyasının oluşması başarı sayılmaz; bütünlük/okunabilirlik doğrulanır.
- PostgreSQL için periyodik gerçek geri yükleme testi; fiziksel dosyalar için örnek geri yükleme + hash doğrulaması yapılır.
- Yedekleme ve geri yükleme denemeleri audit kaydı üretir (`backup_runs`, `restore_test_runs`).
