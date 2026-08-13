---
name: hasarbotu-security-review
description: HasarBotu kodu, konfigürasyonu, dependency'leri, API, Electron, AI, OOXML ve Windows dosya/servis akışlarında kanıta dayalı güvenlik incelemesi veya güvenlik düzeltmesi için kullan.
---

# HasarBotu Güvenlik İncelemesi

## Başlangıç

- Önce `$hasarbotu-production-safety` kurallarını uygula.
- `docs/SECURITY_AND_AI_POLICY.md`, `.claude/skills/VibeSec-Skill/HASARBOTU_SECURITY_OVERLAY.md`, `docs/PROJECT_STATUS.md` ve ilgili en yeni kararı oku.
- Değişen kodla birlikte contracts, auth/RBAC, audit redaction, path resolver, Electron policy ve negatif testleri incele.

## İnceleme yöntemi

- Varsayılanı salt-okunur inceleme say; kullanıcı düzeltme istemediyse dosya değiştirme.
- Bulguyu önem, sömürülebilirlik, etki, kanıt ve dosya/satır ile raporla. Genel web kontrolünü HasarBotu bağlamında doğrulamadan bulgu sayma.
- Organization izolasyonu, RBAC + ownership, mass-assignment allowlist, parametrik SQL, auth/session/cookie, idempotency ve append-only provenance'i kontrol et.
- Path traversal, drive/UNC, reserved ad, reparse point, TOCTOU, zip-slip/bomb, macro/signature/external-link, temp/atomicity ve rollback sınırlarını kontrol et.
- AI/prompt/provider çıktısını güvenilmeyen veri say; egress, PII minimizasyonu, bütçe, schema/evidence ve insan onayı kapılarını kontrol et.
- Electron'da context isolation, node integration, sandbox, IPC/openExternal/download allowlist ve same-origin köprüsünü kontrol et.
- Secret dosyalarını içerik için açma. Tarama çıktısında eşleşen değeri göstermeden yalnız dosya/satır/kategori raporla; secret değerini asla çıktılamama kuralını uygula.

Bir güvenlik düzeltmesi production mutation veya kritik akış değiştiriyorsa ayrı preview/onay/apply/verify kapısını uygula; inceleme sonucu kendiliğinden uygulama yetkisi vermez.

## Doğrulama

- Hedefe yönelik negatif/regresyon testi ekle veya çalıştır; yalnız statik kanaatle “kapatıldı” deme.
- Kapsama göre `npm run typecheck`, `npm run lint`, ilgili workspace testleri, `npm audit` ve `npm run check:deploy` çalıştır.
- Tenant sızıntısı, secret/path/PII redaksiyonu, yetkisiz yazma, traversal/reparse ve fail-closed hata yollarını test et.
- Dependency bulgusunu runtime erişilebilirliği ve mevcut kararla birlikte değerlendir; kapsam dışı lockfile düzeltmesi yapma.
