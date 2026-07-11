# HasarBotu V2 — Karar Günlüğü

Bu dosya, kilitlenmiş ürün kararlarını tekrar etmez. Yalnız geliştirme sırasında eklenen veya değişen kalıcı kararları; tarih, gerekçe ve etkisiyle kaydeder.

## 2026-07-10 — HB-2026-001: Yarı otonom geliştirme ve aşamalı kalite kapıları

Karar:

- Geliştirme işleri küçük ve test edilebilir aşamalara ayrılır.
- Her uygulama aşamasından sonra typecheck, lint, test ve build çalıştırılır.
- Tamamlanan aşamalar `IMPLEMENTATION_PLAN.md` içinde işaretlenir.
- Her görev sonunda `PROJECT_STATUS.md` güncellenir.
- Yeni kalıcı kararlar bu günlükte tarih ve gerekçeyle tutulur.

Gerekçe:

Kullanıcı, kesintisiz fakat kanıtlanabilir ilerleme sağlayan yarı otonom çalışma düzenini kalıcı proje yöntemi olarak belirledi.

Etkisi:

- Testler başarısızken görev tamamlanmış sayılmaz.
- Hatalar önce yerel olarak araştırılır ve yeniden doğrulanır.
- Backend, Electron veya gerçek veri entegrasyonu için mevcut UI-first sınırları değişmez.

Kaynak: 2026-07-10 tarihli kullanıcı talimatı.
