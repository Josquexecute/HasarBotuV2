# Merkezi servis pilotu — 6 Ekim 2026

Kullanıcı tarafından seçilen hedef:

| Alan | Karar |
|---|---|
| Bilgisayar | `DESKTOP-EFN2G33` |
| Gerçek dosya kökü | `C:\HasarBotuStorage\BARAN GLOBAL EKSPERTİZ` |
| Çalışma süresi | Mesai dışında açık kalacak |
| Google / Gmail / otomatik SBM | Ayrı kabul süreci; beklemede, tamamlandı sayılmaz |

**Durum: PARTIAL.** Hedef seçildi; hedefte servis kurulumu ve gerçek evrak
takibi henüz doğrulanmadı. Mevcut çalışma bilgisayarı `51793-22893` hedef
değildir. Buradaki eski Eksist pilotu sentetik veritabanı/alt klasör kullanır;
ofis pilotu yerine geçirilmez.

## Hedefte ilk kontrol

Ön kontrol betiği klasörü ve dosyaları değiştirmez, servis kurmaz, yapılandırma
yazmaz. Bilgisayar adı, gerçek yerel klasör, reparse point, sabit disk,
etkileşimli hesapta listeleme ve Node.js 24 sürümünü kontrol eder.

Ofis bilgisayarında, depo kökünden PowerShell:

```powershell
.\deploy\windows-service\inspect-central-pilot-host.ps1 `
  -ExpectedComputerName 'DESKTOP-EFN2G33' `
  -StorageRoot 'C:\HasarBotuStorage\BARAN GLOBAL EKSPERTİZ'
```

Paket içindeki Node kullanılıyorsa `-NodeExe` ile onun tam yolu verilir.
JSON'daki `PENDING_SERVICE_PROBE`, yalnız ön kontrolün geçtiğini bildirir;
servis hesabında erişim veya uçtan uca takip kabulü değildir.

## Servis pilotu kabul sırası

1. Hedef bilgisayarda mevcut PostgreSQL/HasarBotu servisleri, gerçek V2
   veritabanı, kullanıcı/rol kayıtları ve yedekleme durumu belirlenir. Sentetik
   Eksist DB'si üretim kaydı gibi kullanılmaz. Migration öncesi doğrulanmış
   yedek gerekir; takip için `0050_tracking` dahil şema gerekir.
2. API ve File Agent adayları kendi bağımlılıklarıyla doğrulanır. Node.js
   24.x kullanılır. Sırlar hedefte korunur; pakete/depo/loglara konmaz.
3. Seçilen servis hesabının gerçek köke okuma/listeleme erişimi Session 0'da
   ölçülür. Etkileşimli kullanıcı erişimi bunun yerine geçmez. Yazma gereken
   işlerde mevcut onay ve freshness sınırları korunur.
4. DB'deki gerçek `storage_roots.root_key` seçilen yerel yola eşlenir.
   Takip, kayıtlı `case_locations` konumlarını tarar; yalnız kök tanımlamak
   tüm ofis dosyalarını otomatik kaydetmez. Pilot için gerçek kayıt/klasör
   eşleşmeleri belirlenir ve sorumlu kullanıcı doğrulanır.
5. Bir gerçek dosyada tamamlanmış evrak kopyası → hash gözlemi → API/DB →
   sorumluya bildirim → yetkili inceleme akışı ölçülür. Açık yazıcı, tekrar
   tarama, servis yeniden başlatma ve API kesintisi sınanır. Geçici addan
   nihai ada atomik adlandırma gereken üreticiler ayrıca belirlenir.
6. Kabul geçince otomatik servis başlangıcı ve kesinti sonrası toparlanma
   hedefte doğrulanır. Mesai dışında açık kalma kararı, Windows uyku veya
   oturumdan bağımsız depolama/senkronizasyon çalıştığının kanıtı değildir.

Google OAuth, canlı Gmail, kurumsal hesap/rol eşleşmesi ve gerçek SBM sonuç
kabulü bu pilotun tamamlanma durumundan ayrı tutulur. Bu çalışmada Google
kimlik bilgisi eklenmez ve otomatik SBM etkinleştirilmez.

## Bu oturumun doğrulaması ve erişim engeli

- Node.js `24.21.0` ile güncel UI ve tüm workspace build'leri geçti.
- File Agent: **110/110**; takip API/birim + izole PostgreSQL: **45/45**.
  Google testleri izole sağlayıcı kullanır; canlı Google kabulü değildir.
- Windows servis yapılandırma kontrolü geçti.
- Ön kontrol betiğinin regresyon sonuçları: **8/8**.
- Hedef adı bu bilgisayarda DNS ile çözülemedi: `HostNotFound`.
  Uzak PowerShell kontrolü `ServerNotTrusted,PSSessionStateBroken` ile
  başarısız oldu. Hedef bilgisayarda klasör/servis/veritabanı doğrulanamadı.
  Güvenilen sunucu veya kimlik doğrulama ayarları değiştirilmedi.

Hedefte kuruluma devam etmek için ofis bilgisayarında ön kontrol çıktısı ve
bu bilgisayara erişim gerekir. Bu kayıt gerçek servis pilotunun geçtiğini
veya Google tarafının tamamlandığını bildirmez.
