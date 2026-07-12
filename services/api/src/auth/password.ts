import argon2 from 'argon2'

/**
 * Parola hashleme: Argon2id, OWASP onerilen asgari parametrelerle
 * (m=19456 KiB, t=2, p=1). Parametreler hash icinde tasindigi icin ileride
 * guclendirme geriye uyumlu olur. Ham parola hicbir yerde loglanmaz/saklanmaz.
 */
export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS)
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password)
  } catch {
    // Bozuk/eski bicimli hash dogrulama hatasi kimlik bilgisi hatasi gibi ele alinir.
    return false
  }
}

let dummyHashPromise: Promise<string> | undefined

/**
 * Kullanici bulunamadiginda zamanlama farkini kapatmak icin sabit bir hash'e
 * karsi dogrulama yapilir (user-enumeration timing korumasi).
 */
export async function equalizeVerifyTiming(): Promise<void> {
  dummyHashPromise ??= hashPassword('hasarbotu-dummy-timing-password')
  const dummyHash = await dummyHashPromise
  await verifyPassword(dummyHash, 'definitely-not-the-password')
}
