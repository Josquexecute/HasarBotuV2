---
name: hasarbotu-production-safety
description: HasarBotu V2'de production, veritabanı, dosya sistemi, workbook, Windows servisi, dış veri çıkışı veya release etkisi olan görevlerde ortak güvenlik kapılarını uygular. Bu alanlarda inceleme, planlama, uygulama ya da doğrulama yapılırken kullan.
---

# HasarBotu Üretim Güvenliği

## Önce oku

1. `AGENTS.md` ve varsa kapsamdaki en yakın `AGENTS*.md` dosyasını oku.
2. `docs/PROJECT_STATUS.md` başındaki güncel durumu oku.
3. `docs/DECISION_LOG.md` içinde görevle ilgili en yeni kararları `rg` ile bul.
4. `docs/SECURITY_AND_AI_POLICY.md` ile görev alanının runbook ve kaynak kodunu oku.

Güncel kod/şema/runtime kanıtını eski plan, eski durum kaydı veya hafızadan üstün tut. Çelişkiyi çözmeden mutation yapma.

## Ortak sınırlar

- Kullanıcı kapsamını aynen koru. Salt-okunur talep; düzeltme, staging, commit, servis başlatma veya veri yazma yetkisi vermez.
- Secret değerini asla çıktılamama kuralını uygula; değeri okuma, yazma veya loglama. Yalnız değişken/dosya adını ve gerekirse `var|yok` durumunu göster.
- Gerçek müşteri verisini, PII'yi, workbook hücre içeriğini, e-posta gövdesini, ham provider yanıtını ve tam fiziksel yolu çıktı, fixture, audit veya destek paketine koyma.
- Veritabanında yalnız göreli yol ve mantıksal root kimliği kullan. Runtime kökünü belgelerden tahmin etme; mevcut config/koddan doğrula.
- AI çıktısını güvenilmeyen karar desteği say. İnsan onayı olmadan dosya/klasör/Excel/veri değiştirme, kapatma, ücret/değer kaybı/PERT kararı kesinleştirme veya e-posta gönderme.
- Mevcut kullanıcı değişikliklerini geri alma. Açık talimat olmadan commit, push, tag, release veya branch işlemi yapma.

## Production mutation kapısı

Her production mutation için sırayı bozma:

1. Salt-okunur preflight ve mevcut durum kanıtı üret.
2. Etki alanı, allowlist, beklenen kimlik/hash/sürüm ve rollback içeren immutable plan hazırla.
3. Secret/PII/tam yol içermeyen önizlemeyi göster.
4. Tam bu plan için açık kullanıcı onayı al.
5. Onay sonrası TOCTOU/kimlik/hash/sürüm kontrollerini taze çalıştır; drift varsa fail-closed dur.
6. En küçük kapsamda, idempotent ve mümkünse atomik uygula.
7. Bağımsız geri-okuma/hash/durum doğrulaması yap; gerekiyorsa doğrulanmış rollback uygula.
8. Sonucu ve güvenli audit/provenance kaydını kesinleştir.

Onay; farklı plana, sonraki denemeye veya genişletilmiş kapsama taşınmaz.

## Doğrulama ve rapor

- Başlangıç ve bitiş `git status --short` / `git diff --check` kanıtını al.
- Kapsama uygun en dar testi önce, sonra gerekli workspace/root kapılarını çalıştır.
- Test DB ile production DB'yi ayır; gerçek production mutation'ını test kapısı gibi kullanma.
- Her kapıyı `PASS | FAIL | BLOCKED | UNRUN` olarak gerçek çıktısıyla raporla. Skip ve environment koşulunu PASS sayma.
- Değişen dosyaları, davranış/runtime etkisini, dependency/IPC/veri yazma yolu etkisini, komutları, doğrulanamayanları, riskleri ve sonraki tek adımı belirt.
