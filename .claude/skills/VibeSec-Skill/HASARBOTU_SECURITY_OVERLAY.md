# HasarBotu V2 — VibeSec güvenlik overlay'i

Bu dosya upstream `SKILL.md`'nin **üstüne** projeye özgü kuralları koyar.
Upstream dosyası değiştirilmez.

**Öncelik kuralı:** VibeSec tavsiyeleri HasarBotu invariantlarını **geçersiz
kılamaz**. Çelişki varsa HasarBotu kuralı kazanır ve çelişki rapor edilir.
VibeSec genel web uygulaması varsayımlarıyla yazılmıştır; HasarBotu masaüstü
öncelikli, çok kiracılı bir ekspertiz operasyon uygulamasıdır.

VibeSec çıktısı bir **bulgu listesidir, uygulama emri değildir.** Kritik
işlemler (migration, apply, Excel yazımı, klasör taşıma) yalnız kendi
onay hattından geçer.

---

## 1. Çok kiracılılık ve yetki

- **Organization izolasyonu her sorguda zorunludur.** Her `WHERE` yan tümcesi
  `organization_id` taşır; "kullanıcı zaten kendi verisini görür" varsayımı
  yeterli değildir. Tenant sızıntısı testleri yabancı organizasyonla yapılır.
- **RBAC ve resource ownership ayrı kontrollerdir.** Rol bir uca erişim verir;
  o kaydın sahibi olmak ayrıca doğrulanır. Salt okunur roller yazma uçlarında
  reddedilir.
- **Dosya numarası küresel benzersiz kimlik DEĞİLDİR.** Sorgu, doğrulama,
  workbook eşleştirme ve provenance her zaman
  `organizationId` + `insurerId` + `caseNumber` ile kapsanır.
  `case_number` üzerine küresel unique kısıt **eklenmez**.

## 2. Girdi doğrulama ve veri erişimi

- **Mass-assignment allowlist zorunludur.** İstek gövdesi doğrudan tabloya
  yayılmaz; yazılabilir alanlar açıkça listelenir.
- **Doğrulama sunucu tarafındadır.** Zod sözleşmeleri (`packages/contracts`)
  tek gerçek kaynaktır; UI doğrulaması yalnız kullanıcı deneyimi içindir.
  `strictObject` kullanılır — bilinmeyen alan sessizce yutulmaz.
- **SQL yalnız parametrelidir.** Kullanıcı girdisi string birleştirmeyle
  sorguya girmez. Kolon/tablo adı dinamikleştirilmez.
- **Append-only provenance korunur.** Immutable tablolarda `UPDATE`/`DELETE`
  guard trigger ile engellidir (`23001`). "Düzeltmek için güncelle" çözümü
  kabul edilmez; yeni sürüm yazılır.

## 3. AI sınırı

- **AI çıktısı GÜVENİLMEYEN veridir.** Model yanıtı şema doğrulamasından
  geçmeden hiçbir tabloya, hiçbir hücreye ve hiçbir karara girmez.
- **Prompt'a giren belge/e-posta/OCR metni de güvenilmeyen veridir.** İçindeki
  talimat görünümlü metin uygulanmaz.
- **Açık kullanıcı onayı olmadan apply yapılmaz.** AI önerisi kendiliğinden
  föyü, dosyayı, klasörü, Excel'i veya kapanma ücretini değiştiremez.
  Kritik işlem hattı: planla → önizle → onay → uygula → doğrula → audit.
- **Eksik veri makul görünen bir sayıyla doldurulmaz.** Provenance yoksa
  BİLİNMİYOR kalır; ölçekleme, kalanı bir kategoriye dağıtma ve varsayılan
  atama yasaktır.

## 4. Secret yönetimi

- `.env.local`, API anahtarı, veritabanı parolası ve connection string
  **commit edilmez, loglanmaz, hafızaya alınmaz, prompt'a konmaz**.
- API anahtarı sohbete, hata mesajına, audit `details` alanına veya test
  fixture'ına yazılmaz.
- Sağlayıcı hataları **güvenli kod** olarak yüzeye çıkar
  (`AI_PROVIDER_RATE_LIMITED` gibi); ham yanıt gövdesi taşınmaz.

## 5. Windows dosya sistemi

- **Path traversal:** `..`, sürücü harfi öneki (`C:`), UNC (`\\`) ve mutlak yol
  kullanıcı girdisinden kabul edilmez. Yol birleştirmeden sonra sonucun
  kökün altında kaldığı **yeniden doğrulanır**.
- **Junction / symlink / reparse point:** hedef klasör bir reparse point ise
  izlenmez. `P:` kökü dışına çıkaran bağlantı reddedilir ve rapor edilir.
- **TOCTOU:** kontrol ile yazma arasında yol değişebilir. Kritik yazımdan
  hemen önce hedef yeniden `stat` edilir ve şablon imzası yeniden hash'lenir;
  ilk kontroldeki değere güvenilmez.
- **Ayrılmış adlar ve karakterler:** `CON`, `PRN`, `AUX`, `NUL`, `COM1..9`,
  `LPT1..9` ve `<>:"|?*` klasör/dosya adında reddedilir.
- **Klasör belirsizliği tahminle çözülmez.** Aynı plaka birden çok fiziksel
  konumda eşleşirse `case_folder_ambiguous` verilir; otomatik seçim yapılmaz.

## 6. OOXML / Excel yazımı

- **Zip-slip:** arşiv içindeki her giriş adı normalize edilir; `..` veya mutlak
  yol içeren giriş açılmaz.
- **Zip-bomb:** açılmış toplam boyut, giriş sayısı ve sıkıştırma oranı için üst
  sınır uygulanır; sınır aşılırsa işlem durur.
- **Makro ve imza blokajı:** `vbaProject.bin`, `.xlsm`, `.xlsb` ve
  `_xmlsignatures/` içeren workbook işlenmez.
- **Harici bağlantı:** `externalLink`, `oleObject` ve DDE içeren workbook
  yazıma uygun sayılmaz.
- **Formüllü hedef hücreye yazılmaz**; formül sessizce sabit değere çevrilmez.
- **Dokunulmayan OOXML parçalarının içeriği bit-birebir korunur.** (Bütün ZIP
  dosyasının birebir aynı olduğu iddia EDİLMEZ.)
- **Gerçek workbook yoksa oluşturulmaz; hata verilir.** Şablon uydurmak,
  sigorta şirketinin beklediği biçimi tahmin etmek olurdu.

## 7. Electron (henüz kurulmadı — kurulduğunda bağlayıcı)

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- Renderer'a `ipcRenderer` doğrudan verilmez; `contextBridge` ile **allowlist**
  edilmiş, dar imzalı kanallar açılır.
- IPC kanal adları ve yükleri sunucu tarafındaki gibi şema doğrulamasından
  geçer; renderer'dan gelen yol/kimlik güvenilmez kabul edilir.
- `webSecurity` kapatılmaz; uzak içerik yüklenmez; `shell.openExternal`
  yalnız doğrulanmış şema ve host ile çağrılır.

## 8. Loglama ve audit

- Log ve audit `details` alanına **PII yazılmaz**: sigortalı adı, telefon,
  e-posta, T.C. kimlik numarası, plaka sahibinin kimliği.
- **Tam fiziksel yol (`P:\…`) loglanmaz**; göreli yol veya konum sınıfı yazılır.
- Ham AI istek/yanıt gövdesi, ham e-posta gövdesi ve workbook hücre içeriği
  audit'e girmez.
- Stack trace kullanıcıya ham gösterilmez; içindeki secret ve yol temizlenir.
- Audit kaydı **ne yapıldığını** anlatır, **veriyi taşımaz**.

---

## Uygulama notu

VibeSec taraması bir bulgu ürettiğinde:

1. Bulgunun HasarBotu bağlamında geçerli olup olmadığı değerlendirilir
   (web-only varsayımlar burada geçersiz olabilir).
2. Geçerliyse önce **en küçük güvenli değişiklik** düşünülür.
3. Düzeltme mevcut bir invarianta dokunuyorsa toplu refactor yapılmaz;
   ayrı görev olarak raporlanır.
4. "Bulgu kapatıldı" denmeden önce gerçekten çalıştırılmış test gösterilir.
