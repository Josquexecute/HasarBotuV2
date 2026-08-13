---
name: hasarbotu-email
description: HasarBotu e-posta taslakları, AI metin önerisi, kullanıcı revizyonu, Gmail web handoff, dış veri çıkışı ve ilgili API/UI test görevlerinde kullan.
---

# HasarBotu E-posta

## Başlangıç

- Önce `$hasarbotu-production-safety` kurallarını uygula.
- `docs/SECURITY_AND_AI_POLICY.md` E-posta bölümü, `docs/DOMAIN_RULES.md` Paket 41/42, `docs/TESTING_AND_ACCEPTANCE.md` ve güncel durum/karar kayıtlarını oku.
- `email-draft.ts`, `email-ai.ts`, contracts, `services/api/src/email-drafts|email-ai/`, UI/data-port ve testleri incele.

## Sınırlar

- Deterministik taslak, kullanıcı revizyonu ve opsiyonel AI önerisini ayrı sürümlü kayıtlar olarak koru. AI recipient, attachment, save, handoff veya send kararı veremez.
- Güncel üründe otomatik gönderim veya Gmail OAuth/API yoktur; yalnız kullanıcı kontrollü web compose handoff vardır. Gönderildi/teslim edildi sonucu uydurma.
- Handoff öncesi recipient/subject/body kapsamını görünür göster ve açık egress onayı al. Eki otomatik yükleme, dosya yolu aktarma veya gizli arka plan gönderimi yapma.
- AI provider kullanılırsa organization opt-in/allowlist, bütçe, PII minimizasyonu, preview hash ve no-fallback sınırını koru.
- E-posta gövdesi/recipient, ham prompt/response, gerçek kişi verisi, tam yol ve secret değerini asla log/audit/test çıktısına veya sohbete koyma; secret değerini asla çıktılamama kuralını uygula.

Save/revise/handoff production mutation'ında preview → kullanıcı düzenlemesi → açık teyit/egress onayı → taze draft/version/hash kontrolü → apply/handoff → yalnız doğrulanabilen sonucu audit et. Web compose açılması e-postanın gönderildiğini kanıtlamaz.

## Doğrulama

- Domain/contracts/API/UI e-posta testlerini ve `email-draft-uat-e2e.test.ts` akışını çalıştır.
- 401/403/404, tenant, closed-case, stale preview/hash, missing egress consent, PII minimization, budget blocked, provider failure ve no-fallback yollarını doğrula.
- `npm run typecheck`, `npm run lint` ve kapsamına göre root test/build çalıştır.
- Gerçek Gmail compose veya browser handoff yapılmadıysa UNRUN yaz; otomatik send testi bekleme çünkü ürün davranışı değildir.
