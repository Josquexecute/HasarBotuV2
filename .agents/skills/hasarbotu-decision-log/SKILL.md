---
name: hasarbotu-decision-log
description: HasarBotu'da doğrulanmış ürün/teknik/production kararını `docs/DECISION_LOG.md` ve gerekiyorsa `docs/PROJECT_STATUS.md` içine tutarlı, kanıta dayalı ve gizlilik güvenli biçimde kaydetmek için kullan.
---

# HasarBotu Karar Günlüğü

## Başlangıç

- Önce `$hasarbotu-production-safety` kurallarını uygula.
- `AGENTS.md`, `docs/DECISION_LOG.md` son kayıtları, `docs/PROJECT_STATUS.md` başı ve görevle ilgili kanonik belge/kodu oku.
- `rg` ile benzer kararları ve en son HB kimliğini bul; ID, tarih veya mevcut durumu tahmin etme.

## Kayıt disiplini

- Yalnız kullanıcı istediğinde veya görev açıkça karar/durum belgesi güncellemesini kapsadığında yaz. Geçmiş kaydı yeniden yazma; düzeltmeyi yeni, açık kayıtla yap.
- Kararı, gerekçeyi, kapsamı, etkisini, onayı, gerçek mutation'ı, doğrulamayı, yapılmayanları ve kalan riski birbirinden ayır.
- Planı uygulanmış gibi; testi geçmiş gibi; eski test sayısını yeni koşu gibi; preview'ı apply gibi yazma.
- Tarihsel plan güncel production kararıyla çelişiyorsa güncel kod/runtime kanıtını belirt ve çelişkiyi saklama.
- Secret, credential, connection string, gerçek müşteri/PII, e-posta/workbook içeriği, admin-only kanıt yolu veya tam fiziksel yolu kayda koyma; secret değerini asla çıktılamama kuralını uygula.
- Gereksiz ham log/komut dökümü yerine güvenli sonuç, exit code, sayım ve kanıt türü yaz.

Bu skill production mutation yapmaz. Bir mutation'ı yalnız mevcut onay ve bağımsız doğrulama kanıtıyla kaydeder; kayıt yazmak geçmişte eksik onayı meşrulaştırmaz.

## Doğrulama

- Yeni HB kimliğinin tekil olduğunu ve kronolojik başlığın doğru olduğunu `rg` ile doğrula.
- Dosya/referans adlarının gerçekten var olduğunu kontrol et.
- `git diff --check` ve yalnız doküman diff'ini incele; kapsam dışı dosya değişmediğini doğrula.
- `PROJECT_STATUS.md` güncelleniyorsa en üst güncel özet ile detaylı kararın çelişmediğini kontrol et.
- Doküman-only değişiklikte kod testini zorunluymuş gibi çalıştırma; unrun testleri açıkça belirt.
