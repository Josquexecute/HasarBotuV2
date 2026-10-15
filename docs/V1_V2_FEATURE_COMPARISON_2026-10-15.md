# V1 / V2 işlev karşılaştırması

İnceleme tarihi: 15 Ekim 2026.

- V1: [DosyaTakipBotu-main](https://github.com/Josquexecute/DosyaTakipBotu-main/tree/6be015874c04c158e9d3dd460a1d2f3a7a97cea8), `main` dalının `6be015874c04c158e9d3dd460a1d2f3a7a97cea8` commit'i; commit tarihi 9 Temmuz 2026. `package.json` sürümü 0.6.10. README ve bazı eski rehberlerin sürüm bilgisi farklı olduğundan karşılaştırmada çalışan kod bağlantıları esas alındı.
- V2: mevcut çalışma ağacı, masaüstü sürümü 0.1.27; Git tabanı `35fde714d2684b30e6edb7ca1f424453eff3d3e5` ve sonsuz kaydırma değişiklikleri.
- Yöntem: V1 ekranı → işlem/IPC → servis; V2 üretim ekranı → veri adaptörü/API → iş kuralı/işçi bağlantısı. Klasör adları, README vaatleri ve yalnız mock moddaki örnekler uygulanmış işlev sayılmadı.
- Bu bir kaynak kodu denetimidir. V1 kurulmadı/çalıştırılmadı; gerçek ofis dosyaları ve veritabanı değiştirilmedi. Test/build çalıştırılmadı. Aşağıdaki “var” ifadesi kaynakta gerçek bağlantı bulunduğunu belirtir; bu incelemede yeni saha kabulü yapıldığı anlamına gelmez.

## Önemli eksikler

| İşlev | V1 kanıtı | V2 durumu | Öncelik |
| --- | --- | --- | --- |
| Excel'den AI işçilik dağıtımı, H–N önerisi, düzeltme, onaylı çıktı | [Excel ekranı][v1-excel], `renderAutoLaborCard`; [IPC][v1-ipc] ve labor servisleri | **Yok.** Dosya modüllerinde Excel/işçilik ekranı bulunmuyor. `services/api/src/labor`, `labor-ai`, `labor-allocation-ai`, `labor-dictionary`, `labor-excel-profile`, `labor-workbook-apply` dizinlerinin her birinde 0 kaynak dosya var. Normal dosya envanteri Excel çıktısı bunun yerine geçmez. | 1 |
| Parça listesi fotoğrafından kalem okuma, dosya/plaka uygunluk kontrolü | [Excel ekranı][v1-excel], `renderPartsPhotoCard`; `src/main/import/parts-list-analyzer.ts` | **Yok.** V2'de poliçe PDF/OCR akışı var; parça listesi fotoğrafı okuma ve Excel'e parça/işçilik üretme akışı yok. | 1 |
| Rapor PDF ile fatura PDF'ini AI ile karşılaştırma | [Rapor/fatura ekranı][v1-invoice], [PDF/AI servisi][v1-invoice-service]; ana menüden erişiliyor | **Yok.** Üretim rotalarında, ilgili ekranlarda ve API/domain uygulamasında bu karşılaştırma yok. Faturanın evrak türü olarak tanınması aynı işlev değil. | 1 |
| Uygulama içinde fotoğraf küçük resimleri, galeri ve fotoğraf kontrol özeti | [Evrak/fotoğraf ekranı][v1-photos], `photo:get-thumbnail` IPC | **Kısmi.** [DocumentPhotoApiModule](../src/features/cases/DocumentPhotoApiModule.tsx) gerçek dosya adı, tür, boyut ve doğrulama durumu gösteriyor; açıkça “içerik gösterilmez” diyor. Üretim ekranında gerçek fotoğraf galerisi yok. Klasörü Windows Gezgini'nde açma mevcut. | 1 |
| Kesin rapor klasöründeki PDF'lerden kapanma ücretini okuma; gerektiğinde OCR | [ClosingFeeService][v1-closing], [kapanma ücreti satırı][v1-closing-row] | **Kısmi.** [CaseFeeApiModule](../src/features/cases/CaseFeeApiModule.tsx) tutarı elle alıyor; kaynak rapor sürümü ve sayfası seçiliyor, aday/onay/düzeltme geçmişi tutuluyor. [Closure fee](../packages/domain/src/closure-fee.ts) kaynağı yalnız `manual`. Rapor klasörü tarayıp ücreti otomatik çıkaran akış yok. | 1 |
| Dosya bazında portal yapılacaklar/kontrol listesi | [Portal ekranı][v1-portal] | **Yok.** V1'de işaretlenebilir `portalChecklist` var. V2'nin not/görev akışı var fakat eşdeğer portal listesi ekranı yok. | 1 |
| Ayrı rücu durumu/potansiyeli/notu ve KTT/kusur not ekranı | [Rücu/KTT ekranları][v1-recourse] | **Kısmi.** Rücu için [evrak kuralları](../packages/domain/src/document-requirements.ts), DB'de `recourse_status` ve değer kaybında kusur oranı mevcut. V1'deki rücu potansiyeli/durum/not alanları ile ayrı KTT not ekranı aynı biçimde sunulmuyor. | 1 |
| V1 portal, işçilik, rücu ve KTT kayıtlarını V2'de kullanabilme | V1 `TrackingFile`; [V2 aktarım uygulaması](../services/api/src/v1-import/store.ts) ve [uzlaştırma](../services/api/src/v1-import/remediation.ts) | **Kısmi aktarım.** Bu alanlar ham kaynak görüntüsünde korunuyor; karşılık gelen kullanıcı akışlarına bağlanmamış. Not/görev aktarımının bulunması bütün V1 alanlarının ekrana taşındığı anlamına gelmiyor. | 1 |
| Ekspertiz ücret tarifesi hesaplayıcısı; rapor şablonu seçici; EKSİST atama/rapor süre yardımcısı | [AI yardımcıları][v1-helpers], `expertise-fee-helper.ts`, `report-template-helper.ts`, `deadline-helper.ts` | **Özel araçlar yok.** [LegislationApiContent](../src/features/legislation/LegislationApiContent.tsx) kaynak kütüphanesi ve soru/cevap sağlıyor. Bu, V1'deki yapılandırılmış hesap/seçim araçlarıyla aynı değil. V2'nin EKSİST dosya içe aktarımı ve kapanma ücreti kaydı ayrı işlevler. | 2 |
| Kullanıcı düzeltmelerinden ve onaylı eksper Excel'inden öğrenen işçilik sözlüğü | [Öğrenme paneli][v1-learning]; labor learning/expert learning IPC'leri | **Yok.** İncelenen V2 üretim kodunda öğrenme deposu, onay yönetimi ve işçilik önerisine bağlanan karşılığı bulunmuyor. | 2 |
| Manuel Google AI Mode parça/OEM araştırması; aday onayı; D sütununa kontrollü yazma, yedek ve geri alma | [Parça araştırma köprüsü][v1-oem] ve ilişkili apply/restore IPC'leri | **Yok.** V2'de parça kodu aday deposu ve bu Excel yazma/geri alma akışı yok. V1'de bu araştırma otomatik Google sorgusu değil, prompt/yanıt yapıştırma akışı. | 2 |
| Kendi TXT/MD bilgisini önizleyip onayla bilgi bankasına ekleme | [Bilgi Bankası][v1-knowledge]; import preview/commit servisleri | **Kısmi.** V2'de resmî kaynak kütüphanesi mevcut; kullanıcı bilgisini bu yöntemle ekleyip aramaya dahil eden araç ve API yok. | 2 |
| Listede Bendeki/Bu Hafta/Sahipsiz/Durgun/veri kalitesi kısayolları; etkin listenin Excel çıktısı | [V1 liste][v1-cases], `daily-work.ts` | **Kısmi.** V2 ana sayfasında bugün/geciken/yaklaşan/eksik gibi özetler, listede sorumlu/servis/arama filtreleri var. Bütün V1 kısayolları aynı listede yok. [Envanter Excel çıktısı](../src/features/reports/CaseInventoryExportPanel.tsx) Raporlar ekranında ve tür/durum filtreleriyle var; etkin Dosyalar sorgusunun aynısını dışa aktarma değil. | 2 |
| Ortak AI görev kuyruğu, görev türleri ve tek görev geçmişi ekranı | `ai-task-generator.ts`, `ai-task-history.ts`, Ayarlar'dan açılan `ai-queue-panel.ts` | **Aynı ürün akışı yok.** V2'de teknik işçi kuyruğu ve poliçe/e-posta gibi modüllerin kendi AI akışları var; V1'in ortak görev panosu bulunmuyor. | 3 |
| Yıl/ay/dosya hiyerarşisinde uygulama içi klasör gezgini | [Klasörler ekranı][v1-folders] | **Aynı ekran yok.** V2 dosya listesi, otomatik keşif ve **Klasörü Aç** düğmesi sağlıyor. Bu yüzden klasör erişimi bütünüyle eksik sayılmadı. | 3 |

## V2'de zaten bulunanlar

Şunları yeniden “eksik” sayıp baştan yazmak doğru olmaz:

- Notlar, görevler, sorumlu/servis, takip tarihi ve dosya operasyonları: [CaseOperationsApiModule](../src/features/cases/CaseOperationsApiModule.tsx), [TrackingWorkspace](../src/features/tracking/TrackingWorkspace.tsx).
- Dosya klasörünü açma, klasör değişimini izleme, kapanış/yeniden açma: masaüstü klasör köprüsü ve lifecycle/file agent akışları.
- Trafik/kasko evrak gereksinimleri ve klasör/dosya adına göre tanıma: [document requirements](../packages/domain/src/document-requirements.ts), [tracked document](../packages/domain/src/tracked-document.ts). Gerçek fotoğraf galerisi bunun ayrı bir parçası.
- Ağır hasar ön değerlendirmesi: [PertApiModule](../src/features/cases/PertApiModule.tsx), [pert rules](../packages/domain/src/pert-assessment.ts).
- Trafik değer kaybı, kanıtlar ve rapor akışı: [TrafficValueLossApiModule](../src/features/cases/TrafficValueLossApiModule.tsx), [rapor paneli](../src/features/cases/TrafficValueLossReportPanel.tsx).
- Araç profili ve araç sahipleri; poliçe metni/OCR/analiz; e-posta taslakları: gerçek dosya modüllerine bağlı.
- Ücret kaydı/onayı ve dönem raporu; normal `.xlsx` dosya envanteri çıktısı: mevcut. Eksik olan işçilik Excel merkezi, otomatik PDF ücret okuma ve etkin liste sorgusunun aynı filtrelerle dışa aktarımı.
- Mevzuat kaynakları ve Gemini soru/cevap: mevcut. Eksik olan ayrı ücret/süre/şablon araçları ve kullanıcı bilgi bankası ekleme akışı.
- Bildirimler, kullanıcı/rol/yetki yönetimi, karantina incelemesi ve ofis güncellemeleri mevcut.

## Taşımada dikkat edilecek sınırlar

1. V1'in `takip.json` otoritesi V2'ye geri getirilmemeli. V2'nin merkezi PostgreSQL, kullanıcı yetkisi, sürüm kontrolü ve denetim geçmişi korunmalı. Yerel dosya çalışması/çakışan JSON kopyası ekranlarının birebir bulunmaması tek başına eksik işlev değildir.
2. Eski aktarımın açıklama yorumları tek başına yeterli değil: `remediation.ts` ayrıca araç profili, geçmiş ve kapanış uzlaştırması içeriyor. Bu nedenle “V1 araç/kapanış verileri hiç taşınmıyor” sonucu çıkarılmadı. Portal/rücu/işçilik/KTT için aynı birinci sınıf akış bulunamadı.
3. V1'de kapanma ücreti görüntülemesi plaka anahtarıyla eşleşiyor. V2'ye aktarılacak PDF/parça/fotoğraf özellikleri aynı plakalı, farklı sigortacıya ait iki dosyayı karıştırmamak için dosya kimliği ve kaynak kanıtıyla bağlanmalı.
4. Excel H–N ve D sütunu yazımları; orijinal, formül ve stil koruması; önizleme/onay; yedek ve geri alma birlikte taşınmalı. Yalnız düğme veya sonuç tablosu eklemek tamamlanmış özellik sayılmaz.
5. V1'deki mevzuat/tarife sabitleri bu denetimde güncel hukuk kaynağı olarak doğrulanmadı. Yardımcı işlevler taşınırken uygulanacak tarih/sürüm ve resmî kaynak yeniden doğrulanmalı.

## Önerilen uygulama sırası

1. Günlük dosya çalışması: gerçek fotoğraf önizleme; portal/rücu/KTT alanları ve bunların V1 kayıtlarının kontrollü aktarımı.
2. Excel & Parça Veri Merkezi: fotoğraftan liste, AI işçilik, onaylı Excel çıktısı; ardından öğrenen sözlük ve OEM/yedek/geri alma.
3. Rapor–fatura karşılaştırma ve rapordan ücret çıkarma.
4. Ücret/süre/şablon yardımcıları, bilgi bankası ekleme, liste kısayolları ve dışa aktarma filtresi uyumu.
5. Ortak AI görev panosu ve uygulama içi klasör ağacı.

Bu rapor tespit ve önceliklendirmedir; eksik modüllerin geliştirilip yayımlandığı anlamına gelmez.

[v1-excel]: https://github.com/Josquexecute/DosyaTakipBotu-main/blob/6be015874c04c158e9d3dd460a1d2f3a7a97cea8/src/renderer/app/components/detail.ts#L272
[v1-ipc]: https://github.com/Josquexecute/DosyaTakipBotu-main/blob/6be015874c04c158e9d3dd460a1d2f3a7a97cea8/src/main/ipc.ts#L167
[v1-invoice]: https://github.com/Josquexecute/DosyaTakipBotu-main/blob/6be015874c04c158e9d3dd460a1d2f3a7a97cea8/src/renderer/app/components/report-invoice.ts#L8
[v1-invoice-service]: https://github.com/Josquexecute/DosyaTakipBotu-main/blob/6be015874c04c158e9d3dd460a1d2f3a7a97cea8/src/main/services/report-invoice-service.ts#L78
[v1-photos]: https://github.com/Josquexecute/DosyaTakipBotu-main/blob/6be015874c04c158e9d3dd460a1d2f3a7a97cea8/src/renderer/app/components/detail.ts#L248
[v1-closing]: https://github.com/Josquexecute/DosyaTakipBotu-main/blob/6be015874c04c158e9d3dd460a1d2f3a7a97cea8/src/main/services/closing-fee-service.ts#L74
[v1-closing-row]: https://github.com/Josquexecute/DosyaTakipBotu-main/blob/6be015874c04c158e9d3dd460a1d2f3a7a97cea8/src/renderer/app/components/closing-fee-row.ts#L19
[v1-portal]: https://github.com/Josquexecute/DosyaTakipBotu-main/blob/6be015874c04c158e9d3dd460a1d2f3a7a97cea8/src/renderer/app/components/detail.ts#L264
[v1-recourse]: https://github.com/Josquexecute/DosyaTakipBotu-main/blob/6be015874c04c158e9d3dd460a1d2f3a7a97cea8/src/renderer/app/components/detail.ts#L589
[v1-helpers]: https://github.com/Josquexecute/DosyaTakipBotu-main/blob/6be015874c04c158e9d3dd460a1d2f3a7a97cea8/src/renderer/app/components/ai-helpers.ts#L20
[v1-learning]: https://github.com/Josquexecute/DosyaTakipBotu-main/blob/6be015874c04c158e9d3dd460a1d2f3a7a97cea8/src/renderer/app/components/expert-learning-panel.ts#L14
[v1-oem]: https://github.com/Josquexecute/DosyaTakipBotu-main/blob/6be015874c04c158e9d3dd460a1d2f3a7a97cea8/src/renderer/app/components/ai-mode-part-search-panel.ts#L24
[v1-knowledge]: https://github.com/Josquexecute/DosyaTakipBotu-main/blob/6be015874c04c158e9d3dd460a1d2f3a7a97cea8/src/renderer/app/components/knowledge-panel.ts#L23
[v1-cases]: https://github.com/Josquexecute/DosyaTakipBotu-main/blob/6be015874c04c158e9d3dd460a1d2f3a7a97cea8/src/renderer/app/components/cases.ts
[v1-folders]: https://github.com/Josquexecute/DosyaTakipBotu-main/blob/6be015874c04c158e9d3dd460a1d2f3a7a97cea8/src/renderer/app/components/folders.ts#L12
