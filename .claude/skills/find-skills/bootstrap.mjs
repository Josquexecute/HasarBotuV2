#!/usr/bin/env node
/**
 * find-skills SKILL.md yerel bootstrap'ı.
 *
 * Upstream lisansı doğrulanamadığı için içerik repository'ye COMMIT EDİLMEZ
 * (bkz. UPSTREAM.md). Bu betik sabitlenmiş commit'ten dosyayı indirir ve
 * yalnız bütünlük doğrulanırsa diske yazar.
 *
 * `latest`/`main` üzerinden kayan indirme YAPILMAZ: kaynak sabit commit'tir.
 */
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const COMMIT = '777599e1159e401b11ce4c8a57c20f09a8f1596e'
const SOURCE = `https://raw.githubusercontent.com/vercel-labs/skills/${COMMIT}/skills/find-skills/SKILL.md`
/** Upstream ağacındaki git blob SHA-1; uyuşmazsa dosya YAZILMAZ. */
const EXPECTED_BLOB_SHA1 = 'a41bdd074bb587afd861332cf2f473f3154de4d7'
const EXPECTED_SHA256 = 'c00eeea0e13e74fe4a9d84ba0a8542205a1b736d65f13134fe1a6647eb14976f'

/** Git'in blob hash'i: "blob <bayt>\0" öneki + içerik. */
function gitBlobSha1(buffer) {
  return createHash('sha1')
    .update(`blob ${buffer.length}\0`)
    .update(buffer)
    .digest('hex')
}

const response = await fetch(SOURCE)
if (!response.ok) {
  console.error(`INDIRME_BASARISIZ http=${response.status}`)
  process.exit(1)
}
const content = Buffer.from(await response.arrayBuffer())

const blobSha1 = gitBlobSha1(content)
const sha256 = createHash('sha256').update(content).digest('hex')

if (blobSha1 !== EXPECTED_BLOB_SHA1 || sha256 !== EXPECTED_SHA256) {
  // Sabitlenmiş içerik değişmiş olamaz; değiştiyse kaynak veya aktarım
  // güvenilmez demektir. Sessizce kabul etmek yerine durulur.
  console.error('BUTUNLUK_UYUSMAZLIGI — dosya yazilmadi')
  console.error(`  beklenen blob : ${EXPECTED_BLOB_SHA1}`)
  console.error(`  bulunan blob  : ${blobSha1}`)
  console.error(`  beklenen sha256: ${EXPECTED_SHA256}`)
  console.error(`  bulunan sha256 : ${sha256}`)
  process.exit(2)
}

const target = join(import.meta.dirname, 'SKILL.md')
writeFileSync(target, content)
console.log(JSON.stringify({
  ok: true,
  commit: COMMIT,
  blobSha1,
  bytes: content.length,
  target,
  tracked: false,
  note: 'Lisans belirsiz; dosya .gitignore ile commit disinda tutulur.',
}))
