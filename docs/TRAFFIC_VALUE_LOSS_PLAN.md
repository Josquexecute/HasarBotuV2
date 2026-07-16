# Trafik Değer Kaybı Çekirdeği — 01.07.2026

## 1. Amaç ve sınır

Bu çekirdek yalnız Trafik case’leri için 01.07.2026 döneminde:

- hesaplama girdilerini sürümler,
- kaza öncesi ve onarım sonrası piyasa değer kanıtlarını bağlar,
- değer kaybı ve kusur oranı uygulanmış tutarı taslaklar,
- eksik/çelişkili bilgileri açık belirsizlik olarak tutar,
- insan onayı olmadan sonucu kesinleştirmez.

Kasko değer kaybı, ilan toplama otomasyonu, web scraping, AI rayiç tahmini, SBM entegrasyonu ve rapor/PDF üretimi Paket 32 kapsamı dışındadır.

## 2. Resmî kaynak ve dönem kararı

Kural seti: `traffic-value-loss-market-difference`
Kural sürümü: `2026.07.01.1`
Yürürlük başlangıcı: `2026-07-01`

Kaynaklar:

1. 12.06.2026 tarihli, 33278 sayılı Resmî Gazete değişikliği:
   - Madde 2: değer kaybı; marka, yaş, model, kullanılmışlık, hasarlı kısımlar, geçmiş hasar ve kaza öncesi/onarım sonrası ikinci el satış değeri farkıyla eksper tarafından tespit edilir.
   - Madde 6: eski Ek-1 değer kaybı formülü yürürlükten kaldırılır.
   - Madde 8: yürürlük tarihi 01.07.2026’dır.
   - Kaynak: `https://www.resmigazete.gov.tr/eskiler/2026/06/20260612-3.htm`
2. SEDDK 2026/11 sayılı Genelge:
   - Madde 4 ve Ek-1.1: Trafik hasar eksper raporunda değer kaybı bölümü; geçmiş hasar, parçalar, piyasa araştırması, kaza öncesi/onarım sonrası değer, kusur oranı ve sonuç özeti.
   - Kaynak: `https://seddk.gov.tr/UploadContent/Documents/2026-11_Say%C4%B1l%C4%B1_Genelge.pdf`

Bu sürüm eski `rayiç × %19 × hasar katsayısı × km katsayısı` formülünü uygulamaz.

## 3. Deterministik değerlendirme

Taslak brüt değer kaybı:

`max(0, kazaÖncesiPiyasaDeğeri - onarımSonrasıPiyasaDeğeri)`

Kusur uygulanmış taslak:

`brüt × kusurBazPuan / 10000`

Para değerleri safe integer minor-unit’tir. Yuvarlama sürümü `half_up_minor_unit` olarak açıkça taşınır.

## 4. Kanıt yeterliliği

Resmî mevzuat ile ofis kanıt yeterliliği ayrı tutulur. Aşağıdaki eşikler yasal formül olarak değil, sürümlü kontrol politikası olarak uygulanır:

- kaza öncesi değer için en az 3 emsal,
- onarım sonrası değer için en az 3 emsal,
- gözlem tarihi değerlendirme tarihinden en fazla 30 gün önce,
- emsal kilometresi hedef araç kilometresinin ±%10 aralığında,
- piyasa değerleri, araç kimliği, kilometre, kullanım, parça/onarım, geçmiş hasar, kusur ve ağır/tam hasar durumu doğrulanmış kanıta bağlı.

Eşik karşılanmazsa tutar taslağı hesaplanabilse bile `control_required` olur ve onaya gönderilemez.

## 5. Sürüm ve insan onayı

- Her düzeltme yeni assessment version üretir.
- Önceki kanıt, emsal ve onay geçmişi append-only korunur.
- `case_manager`, `expert`, `admin` taslak oluşturabilir ve onaya sunabilir.
- Yalnız `expert` ve `admin` onaylayabilir veya gerekçeli reddedebilir.
- Approved sürüm immutable’dır; yeni sürüm oluşturulursa önceki approved sürüm `superseded` olur.
- Ağır/tam hasar için tutar üretilmez; `not_applicable` sonucu da insan onayı gerektirir.

## 6. Güvenlik

- Yalnız aynı tenant/case içindeki `ready + hashVerified + sizeVerified + verifiedAt` documentVersion kanıt olabilir.
- API sonucu mutlak yol, dosya adı, belge içeriği, kişisel veri veya secret taşımaz.
- Audit yalnız rule/version, durum, kanıt/emsal/belirsizlik sayıları ve actor/request kimliklerini taşır.
- Harici emsal referansı yalnız `https://` veya kontrollü `ref:` biçimindedir; filesystem yolu kabul edilmez.

## 7. Doğrulama

- Saf domain, strict contracts/JSON Schema, migration 0022 ve API testleri sentetik metadata ile çalıştırıldı.
- Gerçek PostgreSQL’de migration ileri/tekrar/rollback-reapply, tenant, idempotency, optimistic locking, append-only geçmiş ve approved immutability geçti.
- Gerçek TCP smoke login→draft→idempotent replay→submit→approve, 401/404 ve sızıntı sınırını doğruladı.
- Ana ve repository-dışı fresh `npm ci` kopyasında 1050 başarılı / 6 mevcut ortam-koşullu UI skip; Paket 32 kritik testlerinde skip yoktur.

## 8. Paket 33 kullanıcı çalışma alanı

- Gerçek API modunda Dosya Detayı > Değer Kaybı, Paket 32 assessment/read/version/submit/approve/reject akışına DataPort üzerinden bağlanır.
- Kullanıcı araç, kusur, parça ve iki piyasa değerini; her iki taraf için emsalleri; ready/verified belge metadata kanıtlarını girer.
- DocumentVersion seçimi otomatik kanıt kabulü değildir. Araç kimliği, kilometre, kullanım, parçalar, önceki hasar, kusur ve ağır/tam hasar destekleri kullanıcı tarafından ayrı ayrı seçilir.
- Emsal girdileri güvenli kaynak referansı, tarih, kilometre, tutar, doğrulama ve çelişki bayrağı taşır. Adapter mutlak yol veya belge içeriği göstermez; content hash yalnız kanıt komutunda kullanılır.
- Sonuç kartı server taslağı, rule version, resmî kaynak, reasoning, belirsizlik ve submit uygunluğunu gösterir. Bloklayan belirsizlikte kullanıcı yeni version oluşturarak düzeltir.
- Submit ve insan approve/reject adımları ayrı teyitlerdir. Geçmiş version’lar görünür; approved sonuç insan aktörü ve zamanıyla ayrılır.
- Mock modu mevcut prototipi korur; API hatasında mock fallback yoktur. Kasko için bu Trafik hesabı çalıştırılmaz.
- Paket 33 doğrulaması ana ve fresh kopyada 1060 başarılı / 6 mevcut ortam-koşullu UI skip verdi. Gerçek Chrome’da incomplete/control-required → ikinci calculable version → submit → human approve ve API kesintisinde no-fallback; gerçek PostgreSQL’de 2 version, 9 evidence, 6 comparable, 2 approval event ve sızıntısız audit geçti.
