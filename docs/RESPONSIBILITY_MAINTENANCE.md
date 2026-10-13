# Güncel sorumlu ataması

V1 kaynağında sorumlusu boş veya “Atanmadı” olan dosyalar için yeni kullanıcı kararı, geçmiş V1 kimlik eşleştirmesi değildir. `planResponsibilityMaintenance` ve `applyResponsibilityMaintenance` bu güncel atamayı ayrı kaydeder. Kaynak takip dosyaları ve V1 provenance değiştirilmez.

`@hasarbotu/api` içindeki `responsibilityMaintenanceManifestSchema`, hedef sorumlu hesabını, kullanıcı kararını, tekil dosya kimliklerini ve beklenen sürümleri zorunlu tutar. Önizleme veri değiştirmez. Uygulama, tam plan hash’i ve aktif aynı organizasyon yöneticisi gerektirir. Hedef hesap aktif ve `case_manager` olmalıdır; yalnızca halen sorumlusu boş, arşivlenmemiş dosyalar kabul edilir.

Açık ve kapalı dosyalarda sadece sorumlu, sürüm ve güncelleme zamanı değişir. Eksper, kapanış alanları, süreç ve geçmiş kayıtlar korunur. Normal kapalı dosya PATCH kilidi devam eder. İşlem güncel sürümleri tekrar kontrol eder, dosyaları sıralı kilitler ve tüm atamaları mevcut audit servisiyle tek transaction içinde kaydeder. Audit veya sürüm hatasında tüm grup geri alınır. Aynı onaylı planın tekrarı atama ve audit çoğaltmaz.

Kullanıcı kararı, manifest, plan ve önceki dosya snapshot’larını korumalı alanda saklayın; Git’e eklemeyin. Uygulamadan sonra iş alanlarını karşılaştırın, atanan hesabı ve audit kayıt sayısını doğrulayın. Bu bakım aracı mevcut sorumlusu dolu bir dosyanın sorumlusunu değiştirmez; açık dosyalarda sonraki değişiklik normal uygulama akışından yapılır.
