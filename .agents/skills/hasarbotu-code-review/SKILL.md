---
name: hasarbotu-code-review
description: HasarBotu diff, commit, PR veya paket değişikliklerini kapsam, doğruluk, regresyon, güvenlik, test yeterliliği ve production invariantları açısından salt-okunur incelemek için kullan.
---

# HasarBotu Kod İncelemesi

## Başlangıç

- Önce `$hasarbotu-production-safety` kurallarını uygula.
- `AGENTS.md`, `docs/PROJECT_STATUS.md`, ilgili en yeni `docs/DECISION_LOG.md` kararı ve değişen alanın bağlayıcı belgelerini oku.
- `git status`, hedef base/head, diff ve kullanıcıya ait mevcut değişiklikleri doğrula. Dosya/modül davranışı tahmin etme; çağrı zincirini koddan izle.

## İnceleme

- Varsayılanı salt-okunur tut. Kullanıcı açıkça düzeltme istemediyse edit, staging, commit veya mutation yapma.
- Önce scope ihlali, veri kaybı, tenant/RBAC, secret/PII/path sızıntısı, fail-open davranış, idempotency/TOCTOU, append-only ihlali ve yanlış production wiring ara.
- Domain kuralının UI/controller içine kopyalanmasını; contracts/Zod kaynağıyla API/UI drift'ini; closed-case ve lifecycle guard'larını kontrol et.
- Testlerin yalnız mutlu yolu değil, gerçek regresyon ve negatif sınırı kanıtladığını doğrula. Mock ile geçen testin gerçek PostgreSQL/browser/workbook/service kapısını temsil ettiğini varsayma.
- Secret dosyasını açma veya diff çıktısında değeri yeniden üretme; secret değerini asla çıktılamama kuralını uygula.

## Çıktı ve doğrulama

- Bulguları önem sırasıyla, dosya/satır, somut etki ve kısa gerekçeyle yaz. Kanıtlanmamış olasılığı kesin hata gibi sunma.
- Bulgu yoksa bunu söyle; kalan test/ortam boşluklarını ayrıca belirt.
- İnceleme kapsamına uygunsa mevcut tanımlı, production dışı odak testleri çalıştır. Kaynak değiştirmeyen incelemede gereksiz build artefaktı üretme.
- Çalıştırılan komutların gerçek sonucunu, skip/timeout/Windows exit kodunu ve çalıştırılmayan gate'leri dürüstçe raporla.
- Düzeltme istenirse en küçük güvenli patch'i ayrı uygulama adımı olarak ele al; production mutation için yeniden açık onay iste.
