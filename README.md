# HasarBotu V2 — AI Geliştirme Yönetişim Paketi

Bu paket, HasarBotu V2 üzerinde Codex, Claude Code, Gemini CLI, GitHub Copilot, Cursor, Windsurf ve benzeri yapay zekâ kodlama araçlarının aynı ürün kurallarına göre çalışmasını sağlamak için hazırlanmıştır.

## Talimat önceliği

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

Çelişki varsa tahmin yürütülmez. Değişiklik yapılmadan önce kullanıcıya bildirilir.

## Araç köprüleri

- Codex ve genel ajanlar: `AGENTS.md`
- Claude Code: `CLAUDE.md`
- Gemini CLI: `GEMINI.md`
- GitHub Copilot: `.github/copilot-instructions.md`
- Cursor: `.cursor/rules/hasarbotu-v2.mdc`
- Windsurf: `.windsurfrules`

Bu köprü dosyaları ana kuralları tekrar tanımlamaz; `AGENTS.md` ve `docs/` altındaki belgeleri kaynak kabul eder.

## Geçici repository düzeni

- Kabul edilmiş React/Vite UI uygulaması geçiş süresince repository kökünde kalır.
- UI, ileride ayrı ve kontrollü bir paketle `apps/web` altına taşınacaktır.
- `apps`, `services` ve diğer `packages` alanları yalnız gerçek ihtiyaç doğduğunda oluşturulur.
- Boş veya sahte workspace paketleri oluşturulmaz.
- İlk gerçek workspace paketi ortak yapılandırma sınırı olan `packages/config` paketidir.

## İlk kullanım

1. Bu paketin içeriğini boş `HasarBotuV2` repository köküne kopyalayın.
2. Stitch referans ZIP ve ekran görüntülerini `design/references/` altına koyun.
3. İlk görev olarak yalnız UI tasarım sistemi ve uygulama kabuğunu geliştirin.
4. Backend, veritabanı, pCloud, Gmail veya AI API entegrasyonuna UI onaylanmadan geçmeyin.
