# V1 tarihî sorumlu ve eksper düzeltmesi

V1'den aktarılmış kapalı dosyalarda gerçek hesap eşlemeleri sonradan
doğrulandığında bu yönetici aracı kullanılır. Genel dosya PATCH'i kapalı
dosyalarda kilitli kalır. Dosya yeniden açılmaz; yalnız `responsible_user_id`,
`expert_user_id`, `version` ve `updated_at` değişir. Her vaka ve tamamlanan
plan için mevcut append-only audit servisi kullanılır.

Node 24 ile build sonrası depo kökünden çalıştırın. `DATABASE_URL` ortamda
güvenli biçimde yapılandırılmış olmalıdır; bağlantı bilgisini komuta yazmayın.

```powershell
node deploy/windows-service/run-v1-assignment-remediation.mjs --manifest C:\protected\assignments.json --organization-id <organization-id>
```

Manifest şeması: `v1AssignmentManifestSchema` ve `V1AssignmentManifest`,
`@hasarbotu/api` tarafından dışa aktarılır. Her vaka için beklenen sürüm,
mevcut sorumlu/eksper kimlikleri ve doğrulanmış kaynak `relativePath`/`sha256`
gerekir. Tek ortak eksper hesabı ile onaylı kaynak eksper adları ve sorumlu
adı → gerçek hesap kimliği eşlemeleri açıkça verilir. Boş/Atanmadı kaynak
sorumlusu null kalır; eşlenmemiş dolu bir ad işlemi durdurur. Vaka kimlikleri
tekil olmalı ve her kaynak hash'i o vakaya ait V1 provenance kaydıyla eşleşmelidir.

Önizleme DB veya kaynak dosyalarını değiştirmez. Çıktıdaki plan hash'i
incelendikten sonra `--apply --actor-user-id <active-admin-id>
--expected-plan-hash <preview-hash>` eklenir. CLI gerçek interaktif terminalde
tam `UYGULA <preview-hash>` metnini ister. Yönetici rolü tenant içinde
yeniden kontrol edilir. Eksper hesabı aktif ve `expert`, sorumlu hesapları
aktif ve `case_manager` rolünde olmalıdır. Eksist otomatik alanları korunur.

Tüm vakalar sıralı kilitlenir ve kaynaklar/roller/sürümler yeniden doğrulanır.
Tek değişiklik veya audit hatasında bütün işlem geri alınır. Aynı onaylı
planın tekrarı audit üzerinden tanınır; sürümler ve audit çoğalmaz.
Kaynak klasörlerinde symlink veya kök dışına çıkan yol kabul edilmez.

İşlemden önce korumalı tam vaka snapshot'ı alın; işlem sonrası vaka
alanlarını, kapanış geçmişini ve çalışan API GET yanıtlarını karşılaştırın.
Kişisel veri içeren manifest, plan ve snapshot'ları Git'e eklemeyin.
