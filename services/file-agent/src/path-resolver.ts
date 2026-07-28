import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { parseRelativePath } from '@hasarbotu/domain'

/**
 * Klasik Windows `MAX_PATH` sınırı: 260 karakter NULL sonlandırıcı DAHİL,
 * yani kullanılabilir 259 (bkz. Win32 `CreateFile` belgeleri). Ofis
 * dağıtımında Windows uzun yol desteğinin (`LongPathsEnabled`, >32.767)
 * açılıp açılmayacağı henüz KARARLAŞTIRILMADI
 * (bkz. `DEPLOYMENT_AND_OPERATIONS_PLAN.md` "uzun yol" açık notu); bu yüzden
 * varsayılan, karar verilene kadar KORUYUCU (klasik) sınırda tutulur. Açık
 * karar verilirse değiştirilecek TEK sabit budur.
 */
export const DEFAULT_MAX_ABSOLUTE_PATH_LENGTH = 259

/**
 * Güvenli yol çözümü (Paket 14, D4). Göreli yol ÖNCE domain doğrulamasından
 * geçer (traversal, absolute, sürücü ön eki, UNC/backslash, kontrol karakteri,
 * aygıt adı reddi). Sonra root altında birleştirilir, LEKSİK olarak
 * root-içinde olduğu ve TOPLAM Windows yol uzunluğunun sınırı aşmadığı
 * doğrulanır. Symlink/junction ile root dışına kaçış, gerçek yol
 * (`realpath`) çözümünden sonra `assertRealPathUnderRoot` ile reddedilir.
 *
 * Uzunluk sınırı yalnız BU çözüm noktasında uygulanır; `.hasarbotu-staging`/
 * `.hasarbotu-rename-*` gibi göreli yollar da buradan geçtiği için otomatik
 * kapsanır. Bir dosya adına SONRADAN eklenen sabit sonek (ör. işçilik
 * çalışma kitabı yazımının geçici/kilit dosya adları) bu kontrolün
 * KAPSAMI DIŞINDADIR — sınıra çok yakın bir yol için kalan, belgelenmiş bir
 * risktir.
 */
export class PathSafetyError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'PathSafetyError'
    this.code = code
  }
}

/** Bir yol, root'un ALTINDA mı (veya root'un kendisi mi)? */
export function isUnderRoot(rootAbsolute: string, candidateAbsolute: string): boolean {
  const rel = relative(rootAbsolute, candidateAbsolute)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel) && !rel.startsWith(`..${sep}`))
}

/**
 * Leksik güvenli çözüm: göreli yolu doğrular ve root altında birleştirir.
 * Dosyanın var olmasını GEREKTİRMEZ; yalnız statik güvenlik. Symlink kaçışı
 * ayrıca `assertRealPathUnderRoot` ile kontrol edilir.
 */
export function resolveUnderRoot(
  rootAbsolute: string,
  relativePath: string,
  maxAbsolutePathLength: number = DEFAULT_MAX_ABSOLUTE_PATH_LENGTH,
): string {
  const parsed = parseRelativePath(relativePath)
  if (!parsed.ok) {
    throw new PathSafetyError('unsafe_relative_path', `unsafe relative path: ${parsed.error.code}`)
  }
  const candidate = resolve(rootAbsolute, relativePath)
  if (!isUnderRoot(rootAbsolute, candidate)) {
    throw new PathSafetyError('root_escape', 'resolved path escapes storage root')
  }
  if (candidate.length > maxAbsolutePathLength) {
    throw new PathSafetyError(
      'windows_path_too_long',
      `resolved path exceeds ${maxAbsolutePathLength} characters (Windows MAX_PATH)`,
    )
  }
  return candidate
}

/**
 * Gerçek yolun (symlink/junction çözülmüş) hâlâ root-içinde olduğunu doğrular.
 * Root dışına kaçış varsa `PathSafetyError('root_escape')` fırlatır. Yol yoksa
 * `realpath` ENOENT fırlatır; çağıran bunu `missing` olarak ele alır.
 */
export async function assertRealPathUnderRoot(rootAbsolute: string, candidateAbsolute: string): Promise<string> {
  const realRoot = await realpath(rootAbsolute)
  const realCandidate = await realpath(candidateAbsolute)
  if (!isUnderRoot(realRoot, realCandidate)) {
    throw new PathSafetyError('root_escape', 'real path escapes storage root (symlink/junction)')
  }
  return realCandidate
}
