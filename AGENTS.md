# HasarBotu V2 — Ajan Talimatları

## Ürün
HasarBotu V2, Türkiye'de yalnız Trafik ve Kasko araç ekspertiz dosyalarını yöneten production uygulamasıdır. Mevcut sistemi geliştir; projeyi sıfırdan kurma veya eski UI-first aşamasına dönme.

## Güncel mimari
- PostgreSQL ana iş verisi kaynağıdır.
- Aktif fiziksel dosyalar local storage üzerindedir.
- File Agent kritik klasör/dosya işlemlerinin tek yürütücüsüdür.
- pCloud canlı çalışma kökü değildir; backup/archive amacıyla kullanılır.
- Desktop → local API → PostgreSQL/File Agent mimarisini koru.
- Plaka benzersiz kimlik değildir; caseId esastır.
- Trafik ve Kasko dışında dosya türü üretme.

## Çalışma biçimi
- Önce mevcut kodu ve gerçek akışı incele; dosya, tablo, API veya davranış uydurma.
- En küçük güvenli değişikliği yap; gereksiz refactor yapma.
- Kullanıcının mevcut değişikliklerini geri alma.
- Yeni ücretli servis/abonelik/harici zorunlu bağımlılık ekleme.
- Secret, .env, gerçek müşteri verisi veya PII commit etme.
- Hata/test sonucu/uygulanmayan işlemi gizleme veya yapılmış gösterme.
- Windows/PowerShell uyumluluğunu koru.

## Kaynak doğruluğu ve token kullanımı
- Repository kodu, şema ve migration'lar mevcut davranış için birincil kaynaktır.
- `docs/PROJECT_STATUS.md` ve `docs/DECISION_LOG.md` çok büyüktür: TAMAMINI varsayılan olarak okuma.
- Büyük belgelerde önce `rg`, `git grep`, `Select-String` veya hedefli arama kullan; yalnız ilgili bölümü aç.
- Görevle ilgisiz roadmap, audit ve tarihsel belgeleri context'e alma.
- Aynı bilgiyi tekrar tekrar özetleme veya uzun terminal çıktısını conversation'a dökme.
- Büyük test/log çıktısını dosyaya yönlendir; PASS özetini veya yalnız hatalı bölümü incele.

## Kritik güvenlik
Production write, DB migration, restore, deploy, servis/ACL/env değişikliği, kritik dosya hareketi veya geri döndürülemez işlem için:
1. mevcut durumu doğrula
2. preview/preflight yap
3. rollback/backup imkânını doğrula
4. açık onay olmadan mutation yapma
5. mutation sonrası bağımsız doğrula

Kritik işlemler fail-closed olmalı. AI öneri/kanıt üretir; kritik sonucu kullanıcı onayı olmadan kesinleştirme.

## Git
- Görev tamamlandığında uygun ise atomik commit oluştur.
- Push, tag, release, force-push, branch silme veya `git reset --hard` açık talimat olmadan yapma.
- Commit amend etme; yeni atomik commit tercih et.
- Beklenmeyen çalışma ağacı değişikliklerini silme veya commit'e katma.
- `node_modules`, build/cache/log, `.env` ve gerçek veri commit edilmez.

## Test seviyesi
Değişikliğe göre en küçük yeterli gate'i kullan:
- Küçük değişiklik: ilgili test + ilgili typecheck.
- Paket/feature kapanışı: ilgili testler + typecheck + lint + build.
- Release, migration, security veya production: full test/E2E/build/deploy/smoke gate.
Her küçük değişiklikte bütün test zincirini gereksiz yere çalıştırma.
Çalıştırılmayan testi PASS diye raporlama.

## UI
Mevcut kompakt Windows/ofis tasarımını koru: Türkçe, light + gerçek dark tema, yoğun ama okunabilir master-detail yapı, görünür scrollbar ve 1366x768 / 1920x1080 uyumu. Generic SaaS veya pazarlama sitesi görünümüne dönüştürme.

## Final
Finali kısa tut:
- ne değişti
- test/gate sonucu
- commit
- yalnız gerçek blocker/risk
Uzun tekrar veya tüm komut dökümü verme.
