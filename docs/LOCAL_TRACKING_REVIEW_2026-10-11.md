# Yerel takip — istisna ve çalışan eşleştirme hazırlığı

**İnceleme paketi PASS; gerçek eşlemelerin uygulanması ve tam kullanım PARTIAL.**

[Genişletme raporundaki](LOCAL_TRACKING_EXPANSION_2026-10-11.md) açık maddeler,
11 Ekim 2026 11:34 Türkiye saati itibarıyla yeniden salt okunur incelendi.
İşlem yalnız `hasarbotu_local_tracking_20261011_test` ortamında yapıldı.

## Hazırlanan inceleme paketi

Ayrıntılar kişisel hasar bilgisi içerdiği için Git'e alınmadan, mevcut korumalı
`C:\HasarBotuPilot\local-tracking-20261011\private\review-20261011` dizininde tutulur.

- [İstisna inceleme listesi](C:/HasarBotuPilot/local-tracking-20261011/private/review-20261011/ISTISNA_INCELEME_LISTESI.md): 165 kayıtsız klasör, 5 sorunlu kaynak ve 1 çoklu konum kaydı; toplam 171 karar maddesi. Her maddede konum, mevcut kanıt, önerilen sonraki adım ve bekleyen karar bulunur.
- [Çalışan ve servis eşleştirme tablosu](C:/HasarBotuPilot/local-tracking-20261011/private/review-20261011/CALISAN_ESLESTIRME_TABLOSU.md): 2 sorumlu adı, 1 eksper adı, 5 servis adı; kaynak klasör ve tekil aktarılmış kayıt sayıları ayrı gösterilir.
- `review-data.json`: istisna kimlikleri, kaynak hash'leri, eşleme anahtarları, 379 tekil kaydın kaynak/mevcut atamaları ve sürümleri; doldurulacak karar alanları. Otomatik uygulama manifesti değildir.

## Yeni bulgular

| Bulgu | Sonuç |
|---|---|
| Gerçek aktif çalışan hesabı | 0; mevcut tek hesap test gözlemcisi |
| Aktif eksper / servis kaydı | 0 / 0 |
| Test gözlemcisine atanmış gerçek kayıt | 378; sorumlu alanları dolu |
| V1'de atanmamış sorumlu | 40 kaynak klasör: 37 aktarılmış kayıt, 3 karantina kaynağı |
| Kayıtsız klasörlerde `takip.txt` | 0 / 165 |
| Kayıtsız klasörlerde mevcut V2 plaka adayı | 0 / 165; bu sonuç kayıt üretme veya kapsam dışına çıkarma gerekçesi sayılmaz |
| Belge türü tarama hataları | 2; 87 ve 134 belge adayı mevcut 64 dosya sınırını aşıyor; bu iki envanterde erişim hatası yok |

Önceki önizlemenin 39 atanmamış sorumlu sayısı, referans çözümlemesine ulaşabilen
kaynakları sayar. Ham sidecar incelemesi erken karantinaya ayrılmış bir ek kaynağı
da içerir; 40 kaynak klasörünün 37'si aktarılmıştır. Sayılar aynı kapsamı ölçmez.

Mevcut aktarım dolu `responsible_user_id` değerini değiştirmez; gerçek kullanıcı
eşlemesi mevcut test gözlemcisi atamasıyla çakışma olarak değerlendirilir.
Hesaplar doğrulandıktan sonra 378 atama vaka güncelleme ve audit yolu üzerinden
açıkça değiştirilmelidir. Aktarımı tekrar çalıştırmak bu geçişi tamamlamaz.

## Doğrulama

- **12/12 veri ve runtime kontrolü PASS:** istisna kapsamı, tekil vaka kapsamı,
  kaynak adları/eşleme anahtarları, atanmamış sorumlular, test hesabının gerçek
  adaylardan dışlanması, bekleyen kararlar, tarama sınırı kanıtı, tablo tutarlılığı,
  sırların çıktıdan dışlanması ve mevcut runtime sayıları.
- **385/385 sidecar SHA-256** güncel önizlemedeki hash ile aynı.
- Mevcut vakaların kimlikleri, atamaları ve sürümleri başlangıç snapshot'ıyla
  aynı. 378 takip konumu, 25.570 gözlem ve 25.570 bildirim korunuyor.
- Kaynak dosyalara, üretime veya iş kayıtlarına yazılmadı. Kaynak kodu değişmedi;
  uygulama testleri/build tekrar çalıştırılmadı.
- Gerçek reboot kabulü **PENDING_NO_NEW_BOOT**. Üç servis Running/Automatic,
  tarama ve UI HTTP kontrolü başarılı; yeni Windows açılışı henüz görülmedi.

Kişisel bilgi içermeyen doğrulama kanıtları:
`.local/local-tracking-20261011/review-preparation-summary.json` ve
`.local/local-tracking-20261011/review-validation.json`.

## Sonraki uygulama adımı

Gerçek çalışan hesap kimlikleri/rolleri ve ad eşlemeleri belirlenmeli;
37 atanmamış aktarılmış kaydın sorumlusu ayrıca seçilmelidir. Ardından istisna
kararları kimlik/tür/konum kanıtıyla doldurulmalı, güncel hash ve sürüm kontrolü
sonrasında yetkili güncelleme yollarıyla uygulanmalıdır. Bilgisayarın uygun
zamandaki yeniden başlatılmasından 10 dakika sonra reboot kabulü incelenmelidir.

## Kullanıcı kararları ve manuel kayıt — 11 Ekim 2026

Bu bölüm yukarıdaki ilk incelemeden sonra yapılan değişiklikleri kaydeder.
Kullanıcı, gerçek hesapları programdan elle kaydetmek ve sorumlusu belirsiz
kayıtları ayrı listede tutmak istedi.

Yönetici oturumunda **Yönetim → Kullanıcılar → Kullanıcı Ekle** akışı eklendi.
Ad soyad, gerçek giriş e-postası, 10–128 karakter başlangıç parolası ve en az
bir rol seçilir. Başlangıç parolasıyla giriş yapılabilir. Yeni kullanıcı
sorumlu referansında, Eksper rolü seçildiyse eksper referansında da görünür.
Hesap oluşturmak mevcut dosya atamalarını otomatik değiştirmez.
Kayıt, rol ilişkileri ve audit tek transaction içinde saklanır; parola hash
olarak tutulur, yanıta/audit kaydına yazılmaz. Yetkisiz kayıt ve yinelenen
e-posta reddedilir.

Çalışan tablosunda sorumlular için `case_manager`, eksper için `expert`
kararı kaydedildi. Gerçek e-posta ve V2 kimlikleri kullanıcı tarafından
elle oluşturulmayı bekliyor. Test ortamına hayalî çalışan hesabı eklenmedi;
başarılı hesap oluşturma testleri ayrı ve silinebilir regresyon veritabanında
yapıldı. Beş servis eşlemesi gerçek servis kimliği bekliyor.

171 istisna satırının tamamına kanıtla karar veya gerekçeli bekletme kararı
yazıldı. Bunlar kaynak/vaka verilerine uygulanmış düzeltmeler değildir:

- Aynı kaynak kimliğindeki iki klasörün 78/78 evrakı aynı SHA-256 değerine
  sahip. Plakası geçerli ana klasör seçildi; kopya kaynakta korunacak.
- Çoklu konum kaydında 50 evrak, güncel revizyon ve açık sorumlu bilgisi
  içeren kapalı klasör seçildi. Tarihî boş klasör korunacak.
- İki tarama hatasında dosya sınırı yanında karışık tür kanıtı görüldü.
  Hasara ait tür kesinleşene kadar karantina korunuyor.
- Kimliği bozuk kaynakta sigortacı/ihbar ayrımı kesinleşmedi; kaynak
  yeniden adlandırılmadı veya birleştirilmedi.
- 165 kayıtsız klasör ayrı incelemede tutuluyor. 137 klasör için kaynak
  dosya listesinde plaka adayları bulundu; bu, aynı hasar kanıtı sayılmadı.

Güncel kapalı klasörün açık sorumlu bilgisi, önceki 37 belirsiz aktarılmış
kaydın birini kaynak düzeyinde açıklıyor; gerçek hesap kimliği yine bekliyor.
[Sorumlusu belirsiz ayrı listede](C:/HasarBotuPilot/local-tracking-20261011/private/review-20261011/SORUMLUSU_BELIRSIZ_KAYITLAR.md)
**36 aktarılmış kayıt ve 3 karantina kaynağı** var. Liste ve kararlar korumalı
inceleme paketinde tutulur; kişisel bilgiler Git'e eklenmez.

Doğrulama: frontend **369 PASS, 8 SKIP**; sözleşmeler **291/291 PASS**;
gerçek veritabanlı kullanıcı/yetki/referans testleri **10/10 PASS**;
karar/veri kontrolleri **11/11 PASS**. Node **24.21.0** ile tam build PASS. Electron'da gerçek
form → HTTP → PostgreSQL kaydı → yeni hesapla giriş → yeniden yükleme
kontrolü ve ekran görüntülerinin görsel incelemesi PASS.

Skip edilen 8 frontend testi canlı API/entegrasyon ortamı ayarları gerektirir;
bu koşullu testlere ortam bilgisi sağlanmadı. Bu değişiklik için test
kapatılmadı. Üretim ve gerçek kaynak dosyalarına yazılmadı.
Kararların uygulanması, gerçek hesapların oluşturulması ve Windows reboot
kabulü tamamlanmadığı için genel kullanım durumu **PARTIAL**.

Yerel test kurulumuna API ve UI aktarımı PASS: 6.649 API/bağımlılık dosyası
ve 46 UI dosyası doğrulandı; önceki sürüm yedeklendi. Dağıtılmış yeni POST
ucu, yetki/validasyon ve UI hash kontrolü PASS. Üç servis Running/Automatic;
378 takip konumu, 25.570 gözlem ve 25.570 bildirim korunuyor. Arayüz:
`http://127.0.0.1:3147`. Açık uygulamada yeni düğme görünmüyorsa sayfayı
yenileyin veya masaüstü uygulamasını yeniden açın.
