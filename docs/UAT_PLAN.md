# HasarBotu V2 — Ofis Kullanıcı Kabul Testi Planı

Tarih: 2026-07-11
Sürüm: `0.1.0-ui-baseline`
Test türü: Yapılandırılmış UI-first prototip kullanıcı kabul testi

## Test amacı

HasarBotu V2 UI-first prototipinin trafik ve kasko ekspertiz operasyonlarında anlaşılır, hızlı ve tutarlı bir masaüstü çalışma alanı sağlayıp sağlamadığını gerçek ofis kullanıcılarıyla değerlendirmek; kabul öncesi sorunları, gereksiz alanları ve kritik eksikleri kayıt altına almaktır.

Bu test üretim güvenliği, gerçek veri doğruluğu veya entegrasyon kabulü değildir.

## Kapsam

- Ana navigasyon ve uygulama kabuğu
- Durum Panosu
- Dosyalar tablosu, arama, filtre, sıralama ve hızlı detay
- Dosya Detayı ve dokuz sekmesi
- Kapanan Dosyalar
- Raporlar ve Ücretler
- Mevzuat ve AI Yardımcısı
- Bildirimler
- Yönetim
- Ayarlar
- Açık/koyu tema, menü durumu, kompakt masaüstü kullanım ve temel klavye akışları
- Anonim mock verinin UAT senaryolarını karşılayıp karşılamadığı

## Kapsam dışı

- Backend, merkezi API ve PostgreSQL
- Electron masaüstü paketi
- pCloud, `P:\` veya gerçek klasör/dosya işlemleri
- Gmail veya gerçek e-posta gönderimi
- Gerçek AI API, mevzuat doğrulaması veya hukuki görüş
- Gerçek Excel/PDF yazma ve dışa aktarma
- Gerçek müşteri verisi, kimlik bilgisi veya canlı sigorta dosyası
- Performans, güvenlik, yedekleme ve felaket kurtarma üretim kabulü

## Test edilecek ekranlar

1. Durum Panosu
2. Dosyalar
3. Dosya Detayı
4. Kapanan Dosyalar
5. Raporlar ve Ücretler
6. Mevzuat ve AI Yardımcısı
7. Bildirimler
8. Yönetim
9. Ayarlar

## Test kullanıcı rolleri

- **Eksper:** Dosya özeti, Ağır Hasar, Değer Kaybı, rapor ve kapanma ücreti görünümünü değerlendirir.
- **Sorumlu:** Arama, filtre, takip, evrak, not/görev ve bildirim akışlarını değerlendirir.
- **Ofis yöneticisi / test gözlemcisi:** Yönetim, rapor, genel kullanılabilirlik ve kabul kriterlerini değerlendirir; sorun kaydını takip eder.
- **UAT kayıt sorumlusu:** Kullanıcı sözünü yorumlamadan `UAT_FEEDBACK.md` ve `UAT_ISSUE_LOG.md` içine kaydeder.

Roller yalnız test bakış açısıdır; prototipte gerçek yetkilendirme uygulanmaz.

## Test öncesi hazırlık

1. Repository kökünde terminal açın.
2. Bağımlılıklar kurulu değilse önce `npm install` çalıştırın. Bu komut uygulama çalışma komutu değildir; yalnız yerel geliştirme bağımlılıklarını hazırlar.
3. Uygulamayı aşağıdaki doğrulanmış komutla başlatın:

   ```powershell
   npm run dev -- --host 127.0.0.1 --port 4173 --strictPort
   ```

4. Tarayıcıda `http://127.0.0.1:4173/` adresini açın.
5. Test boyunca terminali kapatmayın. Sunucu durursa sayfa çalışmaz.
6. Başlangıç durumunu eşitlemek için Ayarlar ekranında **Varsayılanlara Dön** seçeneğini kullanın veya temiz bir tarayıcı profili açın.
7. Kullanılacak ekran çözünürlüğünü senaryoya göre 1366×768 ya da 1920×1080 olarak ayarlayın.
8. Her katılımcı için test tarihi, rolü ve tarayıcı bilgisi `UAT_FEEDBACK.md` başına yazılmalıdır.

Komut `package.json` içindeki `dev: vite` betiğine dayanır. `--host`, `--port` ve `--strictPort` seçenekleri test adresini sabit tutmak için Vite betiğine iletilir.

## Test sırasında uyulacak kurallar

- Yalnız sağlanan anonim mock kayıtları kullanın.
- Gerçek müşteri adı, plaka, poliçe, telefon, e-posta veya belge bilgisi girmeyin.
- Prototip etiketinin görünür kaldığını ve ekranın canlı sistem izlenimi vermediğini kontrol edin.
- Her senaryoyu sırasıyla uygulayın; beklenen sonucu görmeden “Başarılı” işaretlemeyin.
- Kısmen başarılı veya başarısız her sonuç için `UAT_ISSUE_LOG.md` kaydı açın.
- Geri bildirimleri mümkün olduğunca kullanıcının kendi sözleriyle kaydedin.
- Ekran görüntüsü alınırken kişisel veri veya başka uygulama penceresi görünmemelidir.
- Ekran görüntüsü dosyasını issue kaydında yalnız anonim dosya adıyla belirtin; mutlak yerel yol yazmayın.
- Mock butonların gerçek dosya yazdığı, e-posta gönderdiği veya hukuki sonuç ürettiği varsayılmamalıdır.
- Test sırasında terminali kapatmayın ve repository dosyalarını kullanıcı testinin parçası olarak değiştirmeyin.

## Demo veri kapsamı

| Zorunlu örnek | UAT kaydı / görünüm | Kanıtlanan durum |
| --- | --- | --- |
| Normal Trafik dosyası | `2026/183` — `06 ABC 123` | Trafik, açık çalışma akışı |
| Normal Kasko dosyası | `2026/184` — `34 MPA 764` | Kasko, açık çalışma akışı |
| Değer kaybı bekleyen Trafik | `2026/178` — `41 NG 441` | Değer Kaybı bildirimi ve zorunlu süreç |
| Ağır hasar incelemesi | `2026/180` — `34 KTA 908` | PERT ön inceleme bildirimi ve Ağır Hasar sekmesi |
| Eksik evraklı dosya | `2026/184` — `34 MPA 764` | 2 eksik evrak ve Eksik Evrak bildirimi |
| Takip tarihi geçmiş dosya | `2026/181` — `16 BRS 916` | Gecikmiş durum ve dün takip tarihi |
| Onay bekleyen dosya | `2026/179` — `07 YK 220` | Onarım Onayı Bekleniyor |
| Yoğun fotoğraflı stres dosyası | `2026/173` — `34 SU 338` | Evrak ve Fotoğraf → Yoğun Test (108) |
| Uzun notlu dosya | `2026/184` — `34 MPA 764` | Operasyon sekmesindeki uzun servis görüşmesi |
| Kapanmış Trafik dosyası | `2026/168` — `26 ESK 26` | Kapanan Dosyalar Trafik kaydı |
| Kapanmış Kasko dosyası | `2026/164` — `34 SU 338` | Kapanan Dosyalar Kasko kaydı |
| Ücret bekleyen kapanmış dosya | `2026/168` — `26 ESK 26` | Raporlar ve Ücretler → Kontrol Bekliyor |

## Uygulama sırası ve kayıt yöntemi

1. `UAT_SCENARIOS.md` içindeki UAT-01–UAT-25 senaryolarını uygulayın.
2. Her senaryoda sonucu ve kısa kullanıcı notunu doğrudan senaryo altına yazın.
3. Ekran bazlı değerlendirmeyi `UAT_FEEDBACK.md` içine kaydedin.
4. Kısmen başarılı veya başarısız her bulgu için `UAT_ISSUE_LOG.md` içinde benzersiz ID açın.
5. Gün sonunda kritik/yüksek önem kayıtlarını ürün sorumlusu ve eksper ile gözden geçirin.

## Başarı kriterleri

- 25 senaryonun tamamı en az bir Eksper ve bir Sorumlu tarafından uygulanmış olmalıdır.
- Kritik senaryoların tamamı başarılı olmalıdır.
- Ana navigasyon, dosya bulma, hızlı detay, dosya detayı, bildirim yönlendirmesi ve Trafik/Kasko Değer Kaybı ayrımı doğru çalışmalıdır.
- Kullanıcı, temel dosya bilgisine açıklama almadan erişebilmelidir.
- 1366×768 görünümde ana işlemler erişilebilir ve belge gövdesi taşmasız olmalıdır.
- Gerçek veri kullanılmadığı prototip etiketiyle açıkça anlaşılmalıdır.
- Her başarısız/kısmi sonuç için issue kaydı bulunmalıdır.
- UAT kayıtları kişisel veri içermemelidir.

## Kabul kararı

### Kabul

- Kritik veya Yüksek önem seviyesinde açık sorun yoktur.
- Kritik senaryoların %100'ü, tüm senaryoların en az %90'ı başarılıdır.
- Eksper ve Sorumlu ekranı gerçek işte kullanabileceklerini belirtir.
- Genel puan ortalaması en az 8/10'dur.

### Şartlı kabul

- Kritik sorun yoktur.
- Yüksek önem sorunların geçici çözümü vardır ve sahip/tarih atanmıştır.
- Tüm senaryoların %75–89'u başarılıdır.
- Kullanımı engellemeyen orta/düşük sorunlar planlanmıştır.

### Ret

- Herhangi bir Kritik sorun vardır.
- Dosya bulma, doğru dosyaya geçme, Trafik/Kasko ayrımı veya temel navigasyon güvenilir değildir.
- Tüm senaryoların %75'inden azı başarılıdır.
- Kullanıcı gerçek veriyle mock veriyi ayırt edememektedir.
- Kullanıcılar temel akışları sürekli açıklama almadan tamamlayamamaktadır.

## Test bitiş kontrolü

- [ ] 25 senaryonun tamamı sonuçlandırıldı.
- [ ] Eksper ve Sorumlu geri bildirimleri alındı.
- [ ] Kısmi/başarısız sonuçların issue kaydı var.
- [ ] Ekran görüntüleri anonim ve erişilebilir.
- [ ] Kritik ve Yüksek sorunlar gözden geçirildi.
- [ ] Kabul / Şartlı kabul / Ret kararı ve gerekçesi kaydedildi.

Nihai UAT kararı: ____________________
Karar tarihi: ____________________
Onaylayanlar: ____________________
Gerekçe: ____________________

## Resmî UAT kapanışı

- Kapanış tarihi: 11.07.2026
- Nihai karar: **Kabul**
- Kapatılan bulgular: `UAT-ISSUE-001`, `UAT-ISSUE-002`
- Açık Kritik/Yüksek bulgu: 0
- Referans sürüm: `0.1.0-ui-baseline`

Kapsam notu: Kabul yalnız UI-first prototipi kapsar; gerçek backend, veri kaynağı, dosya sistemi veya dış servis kabulü değildir.
