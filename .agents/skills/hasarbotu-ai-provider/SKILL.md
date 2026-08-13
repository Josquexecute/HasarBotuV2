---
name: hasarbotu-ai-provider
description: HasarBotu AI provider adapteri, Gemini/OpenAI config'i, dış veri çıkışı, bütçe, retention, strict output, evidence doğrulaması, live pilot veya provider availability görevlerinde kullan.
---

# HasarBotu AI Sağlayıcısı

## Başlangıç

- Önce `$hasarbotu-production-safety` kurallarını uygula.
- `docs/SECURITY_AND_AI_POLICY.md`, `docs/DOMAIN_RULES.md` AI/provider bölümleri, `docs/PROJECT_STATUS.md` ve `docs/SYSTEM_PRODUCT_INVENTORY_REPORT.md` §16'yı oku.
- İlgili `services/api/src/*-ai/`, `services/api/src/config.ts`, `services/api/src/server.ts`, contracts, domain ve provider testlerini incele.

## Sınırlar

- Provider'ı varsayılan kapalı ve temel uygulamadan opsiyonel tut. Organization allowlist, provider/model seçimi, per-request/aylık hard stop ve açık kullanıcı egress onayı olmadan dış çağrı yapma.
- Production composition'da otomatik provider/model fallback ekleme. Sentetik pilot fallback'ini production davranışı sanma.
- Secret yalnız server process environment'ında kalır. Client, DB, API response, audit, log, test fixture veya sohbete koyma; secret değerini asla çıktılamama kuralını uygula.
- Binary, tam belge/case dump'ı, recipient, plaka, office number, path, session veya File Agent bilgisini provider'a gönderme. Yalnız seçilmiş, doğrulanmış, PII-minimize source anchor metni gönder.
- Provider çıktısını strict runtime schema, bounded alanlar, source-anchor üyeliği ve server-side evidence ile yeniden doğrula. Ham prompt/response'u saklama veya loglama.
- Timeout/outcome unknown durumunda otomatik retry/fallback ile ikinci maliyet üretme; güncel receipt/recovery sözleşmesini koru.
- AI sonucu insan review/promotion/onay olmadan iş kararına veya write yoluna dönüşemez. Mevcut modül boşluklarını config uydurarak kapatma.

Production enablement veya gerçek müşteri çağrısı; privacy/retention/hukuki durum, secret rotation, bütçe, egress önizlemesi ve açık onaydan sonra apply/verify/audit edilir. Onaylı olmayan müşteri verisiyle live pilot yapma.

## Doğrulama

- Varsayılan olarak ağsız adapter/config/schema/evidence/budget/redaction testlerini çalıştır.
- İlgili domain/contracts/API workspace testleri ile `npm run typecheck` ve `npm run lint` çalıştır.
- Disabled, partial config, forbidden provider, budget blocked, schema invalid, evidence mismatch, timeout/outcome unknown ve redaction negatif yollarını doğrula.
- Live provider testi yalnız açık talimat, sentetik veri, görünür maliyet/retention ve ayrı onayla çalıştır; yapılmadıysa UNRUN yaz.
