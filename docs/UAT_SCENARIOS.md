# HasarBotu V2 — UAT Senaryoları

Sürüm: `0.1.0-ui-baseline`
Kapsam: UI-first prototip
Kayıt kuralı: “Kısmen başarılı” veya “Başarısız” seçilen her senaryo için `UAT_ISSUE_LOG.md` kaydı açılır.

## UAT-01 — Yeni Trafik dosyası inceleme

- **Amaç:** Yeni/açık bir Trafik dosyasının temel bilgilerinin anlaşılır olup olmadığını değerlendirmek.
- **Ön koşul:** Uygulama açık, Dosyalar ekranında filtreler temiz.
- **Önem derecesi:** Kritik
- **Adımlar:**
  1. Dosyalar ekranında `2026/183` arayın.
  2. `06 ABC 123` satırını seçin ve sağ hızlı detayı kontrol edin.
  3. Satıra çift tıklayarak tam dosyayı açın.
  4. Özet alanında tür, şirket, servis, sorumlu, ihbar föyü ve hasar dosya numarasını kontrol edin.
- **Beklenen sonuç:** Dosya Trafik olarak açılır; `2026/183`, `F-2026-0987`, `HSR-992-880`, Başkent Oto ve Selin Aras bilgileri tutarlıdır. Özet, takip, evrak ve not/görev bilgileri görünürdür.
- **Kullanıcı sonucu:** ☐ Başarılı ☐ Kısmen başarılı ☐ Başarısız
- **Kullanıcı notu:** ____________________

## UAT-02 — Yeni Kasko dosyası inceleme

- **Amaç:** Yeni/açık bir Kasko dosyasının temel bilgilerinin ve dosya türünün doğru anlaşılmasını değerlendirmek.
- **Ön koşul:** Dosyalar ekranı açık.
- **Önem derecesi:** Kritik
- **Adımlar:**
  1. `2026/184` arayın.
  2. `34 MPA 764` satırını seçin.
  3. Enter veya çift tıkla tam dosyayı açın.
  4. Özet ve Evrak ve Fotoğraf sekmelerini inceleyin.
- **Beklenen sonuç:** Dosya Kasko olarak görünür; Anadolu Sigorta, Akşam Otomotiv ve Ahmet Yılmaz bilgileri tutarlıdır. İki eksik evrak açıkça gösterilir.
- **Kullanıcı sonucu:** ☐ Başarılı ☐ Kısmen başarılı ☐ Başarısız
- **Kullanıcı notu:** ____________________

## UAT-03 — Dosya numarasıyla arama

- **Amaç:** Ofis dosya numarasıyla hızlı ve doğru kayıt bulmayı doğrulamak.
- **Ön koşul:** Dosyalar ekranında filtreler temiz.
- **Önem derecesi:** Kritik
- **Adımlar:**
  1. Arama alanına `2026/181` yazın.
  2. Sonuç satırını ve başlıktaki sonuç sayısını kontrol edin.
  3. Satırı seçerek hızlı detayı açın.
- **Beklenen sonuç:** Yalnız `16 BRS 916` / `2026/181` kaydı bulunur; hızlı detay aynı dosyayı gösterir.
- **Kullanıcı sonucu:** ☐ Başarılı ☐ Kısmen başarılı ☐ Başarısız
- **Kullanıcı notu:** ____________________

## UAT-04 — İhbar föyü numarasıyla arama

- **Amaç:** Plaka dışında ihbar föyü numarasının aranabildiğini doğrulamak.
- **Ön koşul:** Dosyalar ekranında arama boş.
- **Önem derecesi:** Kritik
- **Adımlar:**
  1. Arama alanına `F-2026-0987` yazın.
  2. Sonuç satırını açın.
  3. Özet alanındaki İhbar Föyü No bilgisini kontrol edin.
- **Beklenen sonuç:** `06 ABC 123` / `2026/183` bulunur ve detayda aynı ihbar föyü numarası görünür.
- **Kullanıcı sonucu:** ☐ Başarılı ☐ Kısmen başarılı ☐ Başarısız
- **Kullanıcı notu:** ____________________

## UAT-05 — Servis ve sorumlu filtresi

- **Amaç:** Servis ve sorumlu filtrelerinin birlikte doğru sonuç üretmesini doğrulamak.
- **Ön koşul:** Dosyalar ekranında arama ve filtreler temiz.
- **Önem derecesi:** Yüksek
- **Adımlar:**
  1. Sorumlu filtresinden `Selin Aras` seçin.
  2. Servis filtresinden `Başkent Oto` seçin.
  3. Sonuç sayısını ve kayıt bilgilerini kontrol edin.
  4. Filtreleri temizleyin.
- **Beklenen sonuç:** Birlikte kullanıldığında yalnız `06 ABC 123` görünür; Temizle ile tüm anonim kayıtlar geri gelir.
- **Kullanıcı sonucu:** ☐ Başarılı ☐ Kısmen başarılı ☐ Başarısız
- **Kullanıcı notu:** ____________________

## UAT-06 — Takip tarihi geçen dosyaları bulma

- **Amaç:** Geciken takiplerin operasyon listesinden ayrıştırılabildiğini doğrulamak.
- **Ön koşul:** Dosyalar ekranında filtreler temiz.
- **Önem derecesi:** Kritik
- **Adımlar:**
  1. Takip filtresinden `Geciken` seçin.
  2. `16 BRS 916` ve gecikmiş durum göstergesini bulun.
  3. Satırı seçip hızlı detaydaki takip bilgisini inceleyin.
- **Beklenen sonuç:** Yalnız `followUpTone: late` kayıtları gösterilir; `2026/181` için “Dün, 15:00” bilgisi görünür ve gecikme ayırt edilebilir.
- **Kullanıcı sonucu:** ☐ Başarılı ☐ Kısmen başarılı ☐ Başarısız
- **Kullanıcı notu:** ____________________

## UAT-07 — Dosya hızlı detay paneli

- **Amaç:** Listeyi terk etmeden temel dosya bilgisinin görülebilmesini doğrulamak.
- **Ön koşul:** Dosyalar ekranı açık.
- **Önem derecesi:** Kritik
- **Adımlar:**
  1. `34 MPA 764` satırına tek tıklayın.
  2. Sağ panelde Özet ve Operasyon alanlarını inceleyin.
  3. Paneldeki Tam Dosyayı Aç kontrolünü deneyin veya Escape ile paneli kapatın.
- **Beklenen sonuç:** Sağ panel seçilen dosyayı gösterir; tablo kullanılabilir kalır; Escape paneli kapatır ve yanlış dosya bilgisi gösterilmez.
- **Kullanıcı sonucu:** ☐ Başarılı ☐ Kısmen başarılı ☐ Başarısız
- **Kullanıcı notu:** ____________________

## UAT-08 — Dosya detay sekmeleri arasında çalışma

- **Amaç:** Dokuz dosya sekmesinin boş olmayan, anlaşılır çalışma alanları sunduğunu doğrulamak.
- **Ön koşul:** `34 MPA 764` tam dosyası açık.
- **Önem derecesi:** Yüksek
- **Adımlar:**
  1. Sırayla Özet, Operasyon, Evrak ve Fotoğraf, İşçilik, Ağır Hasar, Değer Kaybı, Raporlar ve Ücretler, E-postalar ve Geçmiş sekmelerini açın.
  2. Her sekmede başlık, durum veya mock içerik bulunduğunu kontrol edin.
  3. Sekme aktif vurgusunu izleyin.
- **Beklenen sonuç:** Dokuz sekmenin tamamı açılır, aktif sekme belirgindir ve hiçbir sekme yalnız boş placeholder değildir.
- **Kullanıcı sonucu:** ☐ Başarılı ☐ Kısmen başarılı ☐ Başarısız
- **Kullanıcı notu:** ____________________

## UAT-09 — Dosya değişiminde sekmenin korunması

- **Amaç:** Benzer dosyaları aynı çalışma bağlamında karşılaştırabilmeyi doğrulamak.
- **Ön koşul:** `2026/184` dosyası açık.
- **Önem derecesi:** Yüksek
- **Adımlar:**
  1. Değer Kaybı sekmesini açın.
  2. Üst başlıktaki Sonraki dosyaya geç kontrolünü kullanın.
  3. Yeni dosyanın kimliğini ve açık sekmeyi kontrol edin.
- **Beklenen sonuç:** `2026/183` dosyasına geçilir ve Değer Kaybı sekmesi açık kalır; içerik Kasko isteğe bağlı durumundan Trafik zorunlu durumuna dönüşür.
- **Kullanıcı sonucu:** ☐ Başarılı ☐ Kısmen başarılı ☐ Başarısız
- **Kullanıcı notu:** ____________________

## UAT-10 — Tek Dosyayı Yenile

- **Amaç:** Yenileme kontrolünün yalnız mock geri bildirim verdiğini ve dosyayı değiştirmediğini doğrulamak.
- **Ön koşul:** Herhangi bir tam dosya açık.
- **Önem derecesi:** Orta
- **Adımlar:**
  1. Tek Dosyayı Yenile butonuna tıklayın.
  2. Geri bildirim mesajını okuyun.
  3. Dosya kimliği ve aktif sekmenin değişmediğini kontrol edin.
- **Beklenen sonuç:** Seçili plaka için mock verinin yenilendiğini belirten bildirim görünür; gerçek dosya veya dış servis işlemi yapılmaz.
- **Kullanıcı sonucu:** ☐ Başarılı ☐ Kısmen başarılı ☐ Başarısız
- **Kullanıcı notu:** ____________________

## UAT-11 — Trafik dosyasında değer kaybı zorunluluğu

- **Amaç:** Trafik dosyasında Değer Kaybı sürecinin zorunlu gösterildiğini doğrulamak.
- **Ön koşul:** `2026/178` veya `2026/183` Trafik dosyası açık.
- **Önem derecesi:** Kritik
- **Adımlar:**
  1. Değer Kaybı sekmesini açın.
  2. Süreç durumunu ve hazırlık maddelerini okuyun.
  3. Kullanıcı onayı uyarısını kontrol edin.
- **Beklenen sonuç:** “Zorunlu süreç” etiketi, parça/onarım hazırlık koşulları ve kullanıcı onayı olmadan kesinleştirilemeyeceği görünürdür.
- **Kullanıcı sonucu:** ☐ Başarılı ☐ Kısmen başarılı ☐ Başarısız
- **Kullanıcı notu:** ____________________

## UAT-12 — Kasko dosyasında değer kaybının zorunlu olmaması

- **Amaç:** Kasko dosyasında Değer Kaybı modülünün zorunluymuş gibi sunulmadığını doğrulamak.
- **Ön koşul:** `2026/184` Kasko dosyası açık.
- **Önem derecesi:** Kritik
- **Adımlar:**
  1. Değer Kaybı sekmesini açın.
  2. Durum etiketini ve açıklamayı okuyun.
  3. İsteğe Bağlı Önizleme butonunu deneyin.
- **Beklenen sonuç:** “İsteğe bağlı” görünür; süreç zorunlu gösterilmez ve buton yalnız mock geri bildirim verir.
- **Kullanıcı sonucu:** ☐ Başarılı ☐ Kısmen başarılı ☐ Başarısız
- **Kullanıcı notu:** ____________________

## UAT-13 — Eksik evrak bildiriminin ilgili dosyaya yönlendirmesi

- **Amaç:** Bildirimden doğru dosyaya güvenilir geçişi doğrulamak.
- **Ön koşul:** Bildirimler ekranı açık.
- **Önem derecesi:** Kritik
- **Adımlar:**
  1. Tür filtresinden `Eksik Evrak` seçin.
  2. `34 MPA 764` için “İki zorunlu evrak eksik” bildirimini bulun.
  3. Dosyaya Git butonuna tıklayın.
  4. Açılan dosya kimliğini ve Evrak ve Fotoğraf sekmesini kontrol edin.
- **Beklenen sonuç:** `2026/184` dosyası açılır; iki eksik evrakla bildirim bilgisi tutarlıdır.
- **Kullanıcı sonucu:** ☐ Başarılı ☐ Kısmen başarılı ☐ Başarısız
- **Kullanıcı notu:** ____________________

## UAT-14 — Ağır hasar süreci görünümü

- **Amaç:** AI önerisi, eksper kanaati ve merkez/sigorta kararının ayrı gösterildiğini doğrulamak.
- **Ön koşul:** `2026/180` / `34 KTA 908` dosyası açık.
- **Önem derecesi:** Kritik
- **Adımlar:**
  1. Ağır Hasar sekmesini açın.
  2. Üç karar sütununu karşılaştırın.
  3. Tahmini hasar, sigorta rayici, mock oran ve yapısal kontrol bilgisini inceleyin.
- **Beklenen sonuç:** AI önerisi, eksper kanaati ve merkez/sigorta kararı birbirine karışmadan ayrı alanlarda görünür; karar kesinleşmiş gibi sunulmaz.
- **Kullanıcı sonucu:** ☐ Başarılı ☐ Kısmen başarılı ☐ Başarısız
- **Kullanıcı notu:** ____________________

## UAT-15 — Not ve görevlerin özet ekranında görünmesi

- **Amaç:** Kullanıcının dosyanın son not ve görevlerini sekme değiştirmeden görebilmesini doğrulamak.
- **Ön koşul:** `2026/183` dosyası Özet sekmesinde açık.
- **Önem derecesi:** Yüksek
- **Adımlar:**
  1. Özet ekranında Notlar ve Görevler bölümünü bulun.
  2. İki notu ve saatli görevi okuyun.
  3. Operasyon sekmesindeki not/görev yapısıyla anlam tutarlılığını değerlendirin.
- **Beklenen sonuç:** Güncel notlar ve açık görevler Özet ekranında görünür; kullanıcı Operasyon sekmesine geçmeden kritik bağlamı anlayabilir.
- **Kullanıcı sonucu:** ☐ Başarılı ☐ Kısmen başarılı ☐ Başarısız
- **Kullanıcı notu:** ____________________

## UAT-16 — Kapanan dosya arama ve filtreleme

- **Amaç:** Kapanmış Trafik ve Kasko dosyalarının bulunup ayrıştırılabildiğini doğrulamak.
- **Ön koşul:** Kapanan Dosyalar ekranı açık.
- **Önem derecesi:** Yüksek
- **Adımlar:**
  1. `2026/168` arayın ve `26 ESK 26` Trafik kaydını kontrol edin.
  2. Aramayı temizleyip Tür filtresinden `Kasko` seçin.
  3. `2026/164` / `34 SU 338` kaydını seçin.
  4. Hızlı detaydaki kapanış, şirket, servis ve ücret bilgisini inceleyin.
- **Beklenen sonuç:** Arama ve tür filtresi doğru kayıtları gösterir; seçilen satır hızlı detayı günceller.
- **Kullanıcı sonucu:** ☐ Başarılı ☐ Kısmen başarılı ☐ Başarısız
- **Kullanıcı notu:** ____________________

## UAT-17 — Raporlar ve ücretler ekranı

- **Amaç:** Operasyon dağılımı ve kapanmış dosya ücret kontrolünün anlaşılır sunulduğunu doğrulamak.
- **Ön koşul:** Raporlar ve Ücretler ekranı açık.
- **Önem derecesi:** Kritik
- **Adımlar:**
  1. Dönem, sorumlu ve servis filtrelerini değiştirin.
  2. Toplam, açık, kapanan ve onaylı ücret göstergelerini inceleyin.
  3. Kapanış Ücreti Bekleyen Dosyalar tablosunda `2026/168` kaydını bulun.
  4. Durumun `Kontrol Bekliyor` ve aday tutarın ₺4.850 olduğunu kontrol edin.
- **Beklenen sonuç:** Filtreler özet görünümü etkiler; tablo yalnız kapanmış ve ücret kontrolü bekleyen anonim kayıtları gösterir; bekleyen tutar kesin toplama dahil edilmiş gibi sunulmaz.
- **Kullanıcı sonucu:** ☐ Başarılı ☐ Kısmen başarılı ☐ Başarısız
- **Kullanıcı notu:** ____________________

## UAT-18 — Mevzuat kaynağı inceleme

- **Amaç:** Geçerli/eski kaynak ayrımı ve kaynak detayının anlaşılır olmasını doğrulamak.
- **Ön koşul:** Mevzuat ve AI Yardımcısı ekranı açık.
- **Önem derecesi:** Yüksek
- **Adımlar:**
  1. Karayolları Trafik Kanunu kaynağını açın.
  2. Tür, yayın, yürürlük, sürüm ve referans alanlarını kontrol edin.
  3. Sürüm filtresini `Eski Sürüm` yapıp arşiv kaydını inceleyin.
  4. Escape ile kaynak detayını kapatın.
- **Beklenen sonuç:** Kaynak detayı doğru açılır; Geçerli ve Eski Sürüm ayrımı görünür; Escape paneli kapatır.
- **Kullanıcı sonucu:** ☐ Başarılı ☐ Kısmen başarılı ☐ Başarısız
- **Kullanıcı notu:** ____________________

## UAT-19 — Mevzuat yardımcısı mock soru-cevap

- **Amaç:** Mock cevabın kaynak referansları ve hukuki sınırla birlikte sunulduğunu doğrulamak.
- **Ön koşul:** Mevzuat ve AI Yardımcısı ekranı açık.
- **Önem derecesi:** Kritik
- **Adımlar:**
  1. Sorunuz alanına `Trafik dosyasında onarım onayı ne zaman gerekir?` yazın.
  2. Kaynaklarda Ara butonuna tıklayın.
  3. Cevabı, güven seviyesini ve dayanak kaynakları inceleyin.
  4. Hukuki uyarının görünür olduğunu kontrol edin.
- **Beklenen sonuç:** Mock cevap ve en az iki kaynak referansı görünür; cevap kesin hukuki görüş veya gerçek AI sonucu gibi sunulmaz.
- **Kullanıcı sonucu:** ☐ Başarılı ☐ Kısmen başarılı ☐ Başarısız
- **Kullanıcı notu:** ____________________

## UAT-20 — Açık/koyu tema

- **Amaç:** Her iki temanın okunabilir ve tutarlı olduğunu doğrulamak.
- **Ön koşul:** Herhangi bir ana ekran açık.
- **Önem derecesi:** Yüksek
- **Adımlar:**
  1. Üst bardaki tema butonuyla koyu temaya geçin.
  2. Tablo, panel, metin, durum etiketi ve scrollbar görünümünü inceleyin.
  3. Açık temaya geri dönün.
  4. Sayfa değiştirip tercihin korunduğunu kontrol edin.
- **Beklenen sonuç:** Koyu tema gerçek siyah/koyu nötrdür; metinler okunur; açık temaya dönüş çalışır ve seçim korunur.
- **Kullanıcı sonucu:** ☐ Başarılı ☐ Kısmen başarılı ☐ Başarısız
- **Kullanıcı notu:** ____________________

## UAT-21 — Menü daraltma

- **Amaç:** Daraltılmış sol menünün alan kazandırırken navigasyonu koruduğunu doğrulamak.
- **Ön koşul:** Sol menü açık.
- **Önem derecesi:** Orta
- **Adımlar:**
  1. Menüyü daraltın.
  2. İkonlarla Dosyalar ve Bildirimler ekranlarına geçin.
  3. Aktif sayfa vurgusunu kontrol edin.
  4. Menüyü yeniden genişletin.
- **Beklenen sonuç:** Menü iki durumda da çalışır; aktif rota görünür ve içerik alanı taşmaz.
- **Kullanıcı sonucu:** ☐ Başarılı ☐ Kısmen başarılı ☐ Başarısız
- **Kullanıcı notu:** ____________________

## UAT-22 — 1366×768 ekran kullanımı

- **Amaç:** Ofis ekranında temel işlemlerin erişilebilir ve kontrollü taşma davranışına sahip olduğunu doğrulamak.
- **Ön koşul:** Tarayıcı viewport'u 1366×768; açık tema ve menü açık.
- **Önem derecesi:** Kritik
- **Adımlar:**
  1. Dosyalar ekranını açın.
  2. Arama ve filtreleri kullanın; bir hızlı detay açın.
  3. Tabloyu yatay ve dikey kaydırın.
  4. Raporlar ve Ücretler ile Dosya Detayı ekranlarını açın.
- **Beklenen sonuç:** Belge gövdesinde kontrolsüz yatay kayma yoktur; geniş tablo kendi alanında kayar; scrollbar görünür ve ana işlemler erişilebilirdir.
- **Kullanıcı sonucu:** ☐ Başarılı ☐ Kısmen başarılı ☐ Başarısız
- **Kullanıcı notu:** ____________________

## UAT-23 — Uzun not ve yoğun fotoğraf senaryosu

- **Amaç:** Uzun içerik ve 100+ fotoğrafta çalışma alanının kullanılabilir kalmasını değerlendirmek.
- **Ön koşul:** `2026/184` veya `2026/173` tam dosyası açık.
- **Önem derecesi:** Yüksek
- **Adımlar:**
  1. Operasyon sekmesinde uzun Servis Görüşmesi notunu okuyun ve kaydırmayı kontrol edin.
  2. Evrak ve Fotoğraf sekmesine geçin.
  3. Normal (12) görünümü inceleyin.
  4. Yoğun Test (108) seçeneğini açın ve fotoğraf alanını kaydırın.
- **Beklenen sonuç:** Uzun not kesilmeden erişilebilir; normal görünüm kullanıcıyı 108 görselle boğmaz; yoğun testte 108 anonim görsel lazy-loading ile listelenir ve belge gövdesi taşmaz.
- **Kullanıcı sonucu:** ☐ Başarılı ☐ Kısmen başarılı ☐ Başarısız
- **Kullanıcı notu:** ____________________

## UAT-24 — Klavye ile temel gezinme

- **Amaç:** Fare kullanmadan temel kontrollerin erişilebilirliğini değerlendirmek.
- **Ön koşul:** Dosyalar ekranı açık; klavye kullanılabilir.
- **Önem derecesi:** Kritik
- **Adımlar:**
  1. Tab ve Shift+Tab ile üst bar, menü, arama ve filtreler arasında ilerleyin.
  2. Focus halkasının görünür olduğunu kontrol edin.
  3. Bir dosya satırında Enter ile tam dosyayı açın.
  4. Dosya sekmeleri ve tema/menü butonlarını klavyeyle çalıştırın.
  5. Açık hızlı detay veya mevzuat detayını Escape ile kapatın.
- **Beklenen sonuç:** Odak kaybolmaz; focus görünürdür; temel butonlar Enter/Space ile çalışır; dosya Enter ile açılır ve Escape açık paneli kapatır.
- **Kullanıcı sonucu:** ☐ Başarılı ☐ Kısmen başarılı ☐ Başarısız
- **Kullanıcı notu:** ____________________

## UAT-25 — Ayarlar ekranı

- **Amaç:** Görünüm tercihlerinin anlaşılır ve gerçek dosya sistemi işlemi olmadan kullanılabilir olmasını doğrulamak.
- **Ön koşul:** Ayarlar ekranı açık.
- **Önem derecesi:** Yüksek
- **Adımlar:**
  1. Tema, tablo yoğunluğu ve sol menü varsayılanını değiştirin.
  2. Varsayılan açılış sayfası seçeneklerini inceleyin.
  3. Mock çalışma klasörü bölümünü okuyun ve Mock Klasörü Değiştir kontrolünü deneyin.
  4. Varsayılanlara Dön butonunu kullanın.
- **Beklenen sonuç:** Görsel tercihler uygulanır; çalışma klasörü yalnız mock geri bildirim verir, gerçek klasör seçici veya dosya sistemi işlemi açılmaz; varsayılanlar geri yüklenir.
- **Kullanıcı sonucu:** ☐ Başarılı ☐ Kısmen başarılı ☐ Başarısız
- **Kullanıcı notu:** ____________________

## Oturum sonuç özeti

- Başarılı: ____ / 25
- Kısmen başarılı: ____ / 25
- Başarısız: ____ / 25
- Kritik senaryolarda başarısız: ____
- Açılan issue sayısı: ____
- Katılımcı kabul önerisi: Kabul / Şartlı kabul / Ret
- Özet not: ____________________
