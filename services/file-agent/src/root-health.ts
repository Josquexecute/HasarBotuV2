import { lstat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Depolama kökü sağlık probu (D4, FILE_STORAGE_AND_AGENT_PLAN §11).
 *
 * `P:\BARAN GLOBAL EKSPERTİZ` gibi bulut-senkron köklerde bağlantı koparsa
 * dizin LİSTELEME çoğu zaman son önbelleklenmiş hâliyle BAŞARILI görünebilir.
 * Bu yüzden yalnız `lstat` YETERLİ SAYILMAZ: köke GERÇEKTEN yazılabildiği,
 * sabit adlı küçük bir işaretçi dosyası yazıp SİLİNEREK doğrulanır.
 *
 * Bu modül Agent'ın fiziksel iş yürütücülerinin (workspace provisioning, file
 * operation, işçilik çalışma kitabı yazımı) ve doğrulama akışının ORTAK giriş
 * kapısıdır: her biri İŞE BAŞLAMADAN ÖNCE bu probu çağırır. Başarısızlıkta
 * sunucuya raporlanan hata kodu HER ZAMAN `storage_unavailable`dır
 * (STORAGE_UNAVAILABLE) — kökün NEDEN erişilemez olduğu (`RootHealthResult.code`)
 * yalnız yerel tanı amaçlıdır ve sunucuya/audit'e taşınmaz.
 */

/** Kök altında oluşturulup hemen silinen sabit adlı işaretçi dosyası. */
export const ROOT_HEALTH_PROBE_FILENAME = '.hasarbotu-health-probe.tmp'

/** Sunucuya raporlanan, birleşik STORAGE_UNAVAILABLE hata kodu. */
export const STORAGE_UNAVAILABLE_ERROR_CODE = 'storage_unavailable'

export type RootHealthCode =
  | 'root_missing'
  | 'root_not_a_directory'
  | 'root_reparse_point_rejected'
  | 'root_not_writable'
  | 'root_probe_failed'

export type RootHealthResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: RootHealthCode }

export interface RootHealthStats {
  isSymbolicLink(): boolean
  isDirectory(): boolean
}

export interface RootHealthFileSystem {
  lstat(path: string): Promise<RootHealthStats>
  writeFile(path: string, content: string): Promise<void>
  unlink(path: string): Promise<void>
}

export const nodeRootHealthFileSystem: RootHealthFileSystem = {
  lstat,
  writeFile: (path, content) => writeFile(path, content),
  unlink,
}

export interface RootHealthOptions {
  /**
   * Yazma yeteneği KANITLANSIN mı? Fiziksel yazma işleri (workspace/file
   * operation/işçilik yazımı) için varsayılan `true`dur. Salt okuma doğrulama
   * işleri (`verifier.ts`) köke ekstra yazma/silme trafiği yüklememek için
   * `false` verir — kökün TAMAMEN kayıp olması hâli yine `lstat` ile yakalanır.
   */
  readonly verifyWritable?: boolean
}

function errno(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code
}

/**
 * Depolama kökünün sahiden erişilebilir (ve istenirse yazılabilir) olduğunu
 * doğrular. G/Ç uçları test edilebilirlik için `fs` parametresiyle enjekte
 * edilebilir; üretim çağrıları varsayılan gerçek dosya sistemini kullanır.
 */
export async function probeRootHealth(
  rootAbsolute: string,
  fs: RootHealthFileSystem = nodeRootHealthFileSystem,
  options: RootHealthOptions = {},
): Promise<RootHealthResult> {
  let metadata: RootHealthStats
  try {
    metadata = await fs.lstat(rootAbsolute)
  } catch (error) {
    return { ok: false, code: errno(error) === 'ENOENT' ? 'root_missing' : 'root_probe_failed' }
  }
  if (metadata.isSymbolicLink()) return { ok: false, code: 'root_reparse_point_rejected' }
  if (!metadata.isDirectory()) return { ok: false, code: 'root_not_a_directory' }
  if (options.verifyWritable === false) return { ok: true }

  const probePath = join(rootAbsolute, ROOT_HEALTH_PROBE_FILENAME)
  try {
    await fs.writeFile(probePath, new Date().toISOString())
  } catch {
    return { ok: false, code: 'root_not_writable' }
  }
  try {
    await fs.unlink(probePath)
  } catch {
    // Yazma başarılıysa kök sağlıklıdır; silme başarısızlığı (ör. anlık
    // paylaşım kilidi) sağlık durumunu DEĞİŞTİRMEZ — sonraki prob aynı adın
    // üzerine yeniden yazar.
  }
  return { ok: true }
}
