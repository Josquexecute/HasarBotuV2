import type { ReadinessResult } from './readiness.js'
import { SUPPORTED_API_MINOR, SUPPORTED_API_MAJOR } from './compatibility.js'

/**
 * Başlangıç kapısı (D3): hazırlık sonucunu kullanıcıya anlatılabilir bir
 * karara çevirir.
 *
 * Electron'u import ETMEZ. Sorgu ve iletişim kutusu ENJEKTE edilir; böylece
 * kapının döngüsü gerçek Chromium olmadan doğrudan test edilebilir ve UX
 * kararı (`dialog`) `main.ts`te kalır.
 *
 * Kapı KULLANICIYI MAHSUR BIRAKMAZ: her başarısız sonuçta yeniden deneme
 * seçeneği sunulur. Sunucu geçici olarak kapalıyken uygulamayı tamamen
 * kullanılamaz kılmak, kapının amacı değildir.
 */

export type GateChoice = 'retry' | 'close'

export interface GateMessage {
  readonly title: string
  readonly detail: string
}

/**
 * Sonuç → Türkçe kullanıcı mesajı. Mesajlar ham hata metni, yol, gövde veya
 * yapılandırma DEĞERİ taşımaz; yalnız API'nin kendi bildirdiği sürüm bilgisi
 * (bir sır değildir) uyum hatalarında tanı için gösterilir.
 */
export function describeReadiness(result: ReadinessResult): GateMessage {
  const expected = `${SUPPORTED_API_MAJOR}.${SUPPORTED_API_MINOR}.x`
  switch (result.outcome) {
    case 'ready':
      return { title: 'Sunucu hazır', detail: 'Sunucu bağlantısı doğrulandı.' }
    case 'unreachable':
      return {
        title: 'Sunucuya ulaşılamıyor',
        detail: result.failure === 'tls'
          ? 'Sunucunun güvenlik sertifikası doğrulanamadı. Bağlantı güvenlik için durduruldu. Bilgisayarın tarihini kontrol edin; sorun sürerse sunucu sertifikasının yönetici tarafından yenilenmesi gerekir.'
          : result.failure === 'wrong_server'
            ? 'Bulunan adres beklenen HasarBotu API yanıtını vermiyor. Sunucu yöneticisi API ve fotoğraf portalı yönlendirmelerini kontrol etmelidir.'
            : result.failure === 'dns'
              ? 'Ofis sunucusu ağda bulunamadı. Ofis ağına bağlanın; misafir ağı veya cihaz yalıtımı sunucu keşfini engelleyebilir. Ağ geldiğinde yeniden deneyin.'
              : result.failure === 'refused'
                ? 'Sunucu HTTPS bağlantısını kabul etmiyor. Sunucudaki HTTPS hizmeti ve port çakışmaları kontrol edilmelidir.'
                : result.failure === 'service'
                  ? 'Güvenli HTTPS hizmetine ulaşıldı ancak ana API henüz yanıt vermiyor. Sunucudaki API ve veritabanı hizmetleri kontrol edilmelidir.'
                  : 'HasarBotu sunucusuna bağlanılamadı. Sunucunun çalıştığını ve ağ bağlantınızı kontrol edip tekrar deneyin.',
      }
    case 'api_degraded':
      return {
        title: 'Sunucu hazır değil',
        detail: 'Sunucu çalışıyor ancak veritabanı bağlantısı sağlıksız bildirildi. Bu durumda oturum açma dâhil hiçbir işlem tamamlanamaz.',
      }
    case 'invalid_response':
      return {
        title: 'Beklenmeyen sunucu yanıtı',
        detail: 'Sunucu beklenen sağlık yanıtını vermedi. Uygulamanın doğru sunucu adresine bağlandığını kontrol edin.',
      }
    case 'unknown_service':
      return {
        title: 'Yanlış sunucu',
        detail: 'Bu adres bir HasarBotu sunucusu değil. Sunucu adresi yapılandırmasını kontrol edin.',
      }
    case 'unparseable_version':
      return {
        title: 'Sunucu sürümü okunamadı',
        detail: `Sunucu sürümü tanınan biçimde değil. Bu masaüstü sürümü ${expected} sunucu sürümüyle çalışır.`,
      }
    case 'incompatible_major':
    case 'incompatible_minor':
      return {
        title: 'Sürüm uyumsuzluğu',
        detail: `Sunucu sürümü (${result.apiVersion ?? 'bilinmiyor'}) bu masaüstü sürümüyle uyumlu değil. Uyumlu sürüm: ${expected}. Masaüstü uygulamasını veya sunucuyu güncelleyin.`,
      }
  }
}

export interface StartupGateDeps {
  readonly automaticRetryDelaysMs?: readonly number[]
  readonly wait?: (ms: number) => Promise<void>
  readonly probe: () => Promise<ReadinessResult>
  readonly prompt: (message: GateMessage, result: ReadinessResult) => Promise<GateChoice>
  /** Sonsuz döngüye karşı üst sınır; kullanıcı her denemede karar verir. */
  readonly maximumAttempts?: number
}

export const DEFAULT_MAXIMUM_GATE_ATTEMPTS = 50

/**
 * Kapıyı çalıştırır: hazır olana kadar sor, aksi hâlde kullanıcıya sor.
 *
 * `proceed` yalnız API hazır VE uyumluyken döner. `abort` kullanıcının
 * kapatma tercihini ya da deneme sınırının aşılmasını temsil eder.
 */
export async function runStartupGate(deps: StartupGateDeps): Promise<'proceed' | 'abort'> {
  const limit = deps.maximumAttempts ?? DEFAULT_MAXIMUM_GATE_ATTEMPTS
  let automaticAttempt = 0
  for (let attempt = 0; attempt < limit; attempt += 1) {
    const result = await deps.probe()
    if (result.ready) return 'proceed'
    const delay = deps.automaticRetryDelaysMs?.[automaticAttempt]
    if (delay !== undefined && ['unreachable', 'api_degraded'].includes(result.outcome) && !['tls', 'wrong_server'].includes(result.failure ?? '')) {
      automaticAttempt++
      await (deps.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms))))(delay)
      continue
    }
    const choice = await deps.prompt(describeReadiness(result), result)
    if (choice === 'close') return 'abort'
  }
  return 'abort'
}
