---
name: hasarbotu-frontend-uat
description: HasarBotu React masaüstü arayüzünde UAT, görsel kabul, gerçek API davranışı, tema, responsive masaüstü çözünürlükleri, scrollbar/overflow ve temel etkileşim doğrulaması için kullan.
---

# HasarBotu Frontend UAT

## Başlangıç

- Önce `$hasarbotu-production-safety` kurallarını uygula.
- `docs/UI_SPEC.md`, `docs/UAT_PLAN.md`, `docs/UAT_SCENARIOS.md`, `docs/UAT_FEEDBACK.md`, `docs/UAT_ISSUE_LOG.md` ve `docs/UI_ACCEPTANCE_REPORT.md` dosyalarını oku.
- `docs/PROJECT_STATUS.md`, ilgili route/component/data-port dosyaları ve component/API UAT testlerini incele.

## Kabul sınırları

- Masaüstü Windows/ofis uygulaması üret; mobil/pazarlama/generic SaaS kalıbına dönüştürme. Türkçe etiketleri, yoğun okunabilir yapıyı ve görünür scrollbar'ı koru.
- 1366×768 ve 1920×1080; açık ve gerçek siyah koyu tema; sol menü açık/kapalı; uzun içerik ve alt içeriğe klavye/scroll erişimini doğrula.
- Ana navigasyon, dosya sekmeleri, Enter/çift tık, geri dönüşte filtre/sıra/scroll, loading/empty/error ve keyboard label/focus davranışını gerçekten çalıştır.
- API modunda mock fallback veya sahte başarı üretme. Mutlak yol, hash, secret, PII ve gerçek müşteri verisini UI/screenshot çıktısında gösterme; secret değerini asla çıktılamama kuralını uygula.
- Runtime/domain/IPC/data-write davranışını UI görevi bahanesiyle değiştirme; gerekiyorsa ayrı kapsam olarak bildir.

UI tek başına production mutation değildir; ancak gerçek API verisi yazan UAT adımında plan/önizleme/onay/apply/verify kapısını ve sentetik/test verisini kullan.

## Doğrulama

- Hedef component/data-port testini, sonra `vitest run src` veya root `npm test` kapsamını çalıştır.
- `npm run typecheck`, `npm run lint`, `npm run build:ui` ve `npm run check:bundle` çalıştır.
- Gerçek tarayıcı/Electron ile iki çözünürlük ve iki temada screenshot/etkileşim kontrolü yap; scroll/overflow/focus sorunlarını görsel olarak incele.
- Browser/Electron veya gerçek API doğrulaması çalışmadıysa component testini onun yerine geçmiş sayma; UNRUN olarak yaz.
