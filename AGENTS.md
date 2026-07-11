# HasarBotu V2 — Ana Ajan Talimatları

Bu dosya repository içindeki bütün yapay zekâ geliştirme ajanları için ana ve bağlayıcı talimattır.

## 1. Proje amacı

HasarBotu V2; Türkiye'de trafik ve kasko ekspertiz dosyalarını ihbar aşamasından kapanışa kadar yöneten, masaüstü öncelikli profesyonel bir operasyon uygulamasıdır.

Ana modüller:

- Durum Panosu
- Dosyalar
- Dosya Detayı
- Notlar, görevler ve takip
- Koşullu evrak kontrolü
- Evrak ve fotoğraf yönetimi
- Dosyaya özel AI Asistanı
- AI İşçilik / Excel
- Ağır Hasar / PERT
- Değer Kaybı
- E-posta hazırlama ve eşleştirme
- Kapanan Dosyalar
- Kapanma Ücreti
- Mevzuat ve AI Yardımcısı
- Raporlar ve Ücretler
- V1 aktarımı

Yalnızca iki ana dosya türü vardır:

- Trafik
- Kasko

Değer Kaybı bağımsız dosya türü değildir. Trafik dosyasında zorunlu, Kasko dosyasında isteğe bağlı modüldür.

## 2. Çalışma ilkeleri

- Önce repository içindeki talimat ve dokümanları oku.
- Dosya, modül, tablo, API veya davranış uydurma.
- Kapsam dışına çıkma.
- Kullanıcı açıkça istemedikçe büyük refactor veya yeniden yazım yapma.
- En küçük güvenli değişikliği tercih et.
- Mevcut kullanıcı değişikliklerini geri alma.
- Gerçek müşteri verisi kullanma.
- Test, log, hata veya eksikliği gizleme.
- Yapılmamış işi yapılmış gibi raporlama.
- Çalıştırılmamış testi geçmiş olarak yazma.
- Kırık veya yarım kritik işlem bırakma.
- Ücretli servisleri temel çalışma için zorunlu hale getirme.

## 3. UI-first zorunluluğu

HasarBotu V2 sıfırdan geliştirilecektir.

İlk aşamada yalnız:

- React
- TypeScript
- Vite
- Tasarım sistemi
- Uygulama kabuğu
- Mock veri
- Tıklanabilir UI prototipi

geliştirilecektir.

UI onaylanmadan aşağıdakilere geçme:

- Electron
- PostgreSQL
- pCloud gerçek işlemleri
- Gmail API
- AI API
- Excel'e gerçek yazma
- Dosya Agent
- Backend servisleri

Stitch çıktıları yalnız görsel ve UX referansıdır. Stitch HTML kodunu üretim kodu olarak kopyalama.

## 4. Nihai UI yönü

- Masaüstü öncelikli Windows/ofis uygulaması
- Mobil veya pazarlama sitesi görünümü yok
- Generic SaaS dashboard görünümü yok
- Yoğun ama okunabilir “dense functionalist” tasarım
- Açık tema + gerçek siyah/koyu tema
- Lacivert koyu tema yok
- Kurumsal mavi vurgu
- İkonlu, daraltılabilir sol menü
- Hibrit master-detail yapı
- Dosyalar ekranında kompakt özelleştirilebilir tablo
- Sağ hızlı detay paneli
- Dosya içinde büyük modüller tam çalışma alanı
- Görünür scrollbar
- 1366×768 ve 1920×1080 uyumu
- Türkçe etiketler
- Sahte Türkçe örnek veriler

Ana navigasyon:

- Durum Panosu
- Dosyalar
- Kapanan Dosyalar
- Raporlar ve Ücretler
- Mevzuat ve AI Yardımcısı
- Bildirimler
- Yönetim
- Ayarlar

Dosya içi sekmeler:

- Özet
- Operasyon
- Evrak ve Fotoğraf
- İşçilik
- Ağır Hasar
- Değer Kaybı
- Raporlar ve Ücretler
- E-postalar
- Geçmiş

## 5. Veri ve mimari kaynak doğruluğu

Nihai mimari hedefi:

- PostgreSQL: ana iş verisi kaynağı
- pCloud / `P:\BARAN GLOBAL EKSPERTİZ`: PDF, Excel, fotoğraf ve fiziksel klasörler
- Veritabanında göreceli yol
- Her cihazda yerel pCloud kökü
- Tek ana Dosya Agent: kritik klasör taşıma ve yeniden adlandırma
- Electron masaüstü uygulaması
- Merkezi API
- Web erişimine hazır mimari

Mutlak `P:\` yolu veritabanına kaynak doğruluk olarak yazılmaz.

Fiziksel klasör örneği:

- `34MPA764`
- `34MPA764 - 2`
- `34MPA764 - 3`

Alt klasörler:

- `EVRAK`
- `HASAR`
- `OLAY YERİ`
- `ONARIM`
- `DEĞER KAYBI`

Plaka benzersiz kimlik değildir. Her vaka ayrı `caseId` alır.

Ofis numarası `YYYY/N` biçimindedir ve firma/yıl bazında sıralı verilir.

## 6. AI güvenlik sınırı

AI yalnız karar desteği sağlar.

Kullanıcı onayı olmadan AI:

- Dosya bilgisi değiştiremez
- Dosya kapatamaz
- Klasör taşıyamaz
- Excel'e yazamaz
- Değer Kaybı sonucunu kesinleştiremez
- PERT kararını kesinleştiremez
- Kapanma ücretini onaylayamaz
- E-posta gönderemez
- Mevzuat kuralını etkinleştiremez

Her AI sonucu mümkünse:

- Sonuç
- Gerekçe
- Kaynak belge
- Sayfa
- Güven seviyesi
- Kontrol gereken noktalar

içermelidir.

## 7. Kritik işlem standardı

Kritik işlemler şu modelle uygulanır:

1. Planla
2. Önizle
3. Kullanıcı onayı
4. Uygula
5. Doğrula
6. Kesinleştir
7. Audit kaydı oluştur

Bu kural özellikle şunlarda zorunludur:

- Klasör taşıma
- Dosya kapatma / yeniden açma
- Excel yazma
- V1 aktarımı
- Kapanma ücreti onayı
- Değer Kaybı onayı
- PERT kanaati
- Veritabanı migration
- Mevzuat kuralı etkinleştirme

## 8. Kod kalitesi

- TypeScript strict modunu koru.
- Gereksiz `any` kullanma.
- Domain modellerini UI modelleriyle karıştırma.
- Tekrarlanan iş kurallarını component içine gömme.
- UI componentlerini küçük ve tek sorumluluklu tut.
- Yeni dependency eklemeden önce mevcut araçları kontrol et.
- Harici CDN, uzak font veya zorunlu internet bağımlılığı kullanma.
- Hataları sessizce yutma.
- Kritik servislerde idempotency ve retry düşün.
- Formül, kural ve eşikleri sabit kodlamak yerine sürümlü yapı kullan.
- Gerçek dosya yazma kodunu mock aşamada ekleme.

## 9. Git güvenliği

Açık talimat olmadan:

- Commit yapma
- Push yapma
- Tag oluşturma
- Release oluşturma
- Force push yapma
- Branch silme
- `git reset --hard` kullanma

`node_modules`, build çıktısı, `.env`, log, gerçek veri ve secret commit edilmez.

## 10. Test zorunluluğu

Her değişiklikte kapsamına uygun olanları çalıştır:

- Type check
- Lint
- Unit test
- Component test
- Build
- Görsel kontrol
- 1366×768 kontrolü
- 1920×1080 kontrolü
- Açık tema
- Koyu tema
- Scroll ve overflow kontrolü

UI görevi tamamlandı sayılmaz; ana navigasyon, sekmeler ve temel etkileşimler gerçekten çalışmalıdır.

## 11. Teslim raporu

Her görev sonunda kısa ve somut biçimde belirt:

1. Değişen dosyalar
2. Yapılan iş
3. Davranış değişikliği
4. Dependency değişikliği
5. Veri modeli / IPC / yazma yolu değişikliği
6. Çalıştırılan komutlar
7. Gerçek sonuçlar
8. Doğrulanamayan noktalar
9. Kalan riskler
10. Sonraki tek mantıklı adım

## 12. Bağlayıcı belgeler

Ayrıntılar için sırayla oku:

- `docs/DECISIONS.md`
- `docs/PRODUCT_REQUIREMENTS.md`
- `docs/DOMAIN_RULES.md`
- `docs/ARCHITECTURE.md`
- `docs/UI_SPEC.md`
- `docs/SECURITY_AND_AI_POLICY.md`
- `docs/TESTING_AND_ACCEPTANCE.md`
- `docs/ROADMAP.md`
