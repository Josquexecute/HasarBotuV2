# @hasarbotu/config

HasarBotu V2 içindeki web, masaüstü ve servis paketlerinin ileride paylaşacağı yapılandırma tabanlarını barındırır.

## Sınırlar

- Özel workspace paketidir; npm registry'ye yayınlanmaz.
- Runtime kodu ve runtime dependency içermez.
- ESM uyumludur.
- İlk içerik, Node ve browser paketlerinin kendi ortam ayarlarıyla genişletebileceği `tsconfig/base.json` dosyasıdır.
- Mevcut root React/Vite uygulaması bu pakete henüz bağımlı değildir ve mevcut tsconfig dosyaları bu tabanı genişletmez.

Ortam özel `lib`, `module`, `moduleResolution`, çıktı ve test ayarları ilgili tüketici pakette tanımlanmalıdır.
