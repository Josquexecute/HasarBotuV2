import { DesktopConfigError } from './config.js'
import { OfficeConnectionSetupError } from './office-connection.js'

export function describeStartupFailure(error: unknown): string {
  if ((error as NodeJS.ErrnoException | null)?.code === 'EADDRINUSE') {
    return 'Uygulamanın kayıtlı yerel portu başka bir işlem tarafından kullanılıyor. İlgili işlemi kapatıp yeniden deneyin. Taslakları korumak için port değiştirilmedi.'
  }
  if (error instanceof OfficeConnectionSetupError) {
    return error.reason === 'timeout'
      ? 'Ofis bağlantısı hazırlanırken süre doldu. Windows izin ekranını ve ağ bağlantınızı kontrol edip HasarBotu’yu yeniden açın.'
      : 'Ofis bağlantısı hazırlanamadı. Ağ bağlantınızı ve Windows izinlerini kontrol edip HasarBotu’yu yeniden açın.'
  }
  if (error instanceof DesktopConfigError) return 'Uygulama yapılandırması doğrulanamadı. Ofis bağlantı ayarlarını kontrol ettirin.'
  return 'HasarBotu başlatılamadı. Uygulamayı yeniden açın; sorun sürerse ofis yöneticisine bildirin.'
}
