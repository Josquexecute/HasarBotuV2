import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function reviewNativeSbom(sbom, evidence) {
  if (!Array.isArray(sbom.components) || !sbom.components.length) throw new Error('Native SBOM has no components')
  const row = c => ({ name: c.name, version: c.version ?? null, licenses: c.licenses ?? [], purl: c.purl ?? null })
  if (evidence) {
    assert.equal(evidence.legalClearanceClaimed, false)
    for (const resolution of evidence.resolutions) {
      const component = sbom.components.find(c => c['bom-ref'] === resolution.bomRef)
      assert.ok(component && component.hashes?.some(h => h.alg === 'SHA-256' && h.content === resolution.archiveSha256), 'License resolution checksum does not match SBOM')
      assert.ok(resolution.licenseExpression && resolution.licenseFiles?.length, 'License source and text required')
    }
    for (const entry of evidence.classifiedEntries) assert.ok(sbom.components.some(c => c['bom-ref'] === entry.bomRef), 'Unknown classified component')
  }
  const classified = [...(evidence?.resolutions ?? []), ...(evidence?.classifiedEntries ?? [])]
  return { components: sbom.components.length,
    upstreamMissingLicenseMetadata: sbom.components.filter(c => !c.licenses?.length).map(row),
    missingLicenseMetadata: sbom.components.filter(c => !c.licenses?.length && !classified.some(e => e.bomRef === c['bom-ref'])).map(row),
    supplementaryEvidence: classified,
    mplSourceNoticeRequired: sbom.components.filter(c => /MPL/.test(JSON.stringify(c.licenses))).map(row),
    codecComponents: sbom.components.filter(c => /^(libaom|libavif|libjpeg|libpng|libwebp|zlib)/.test(c.name)).map(row),
    scopeLimit: 'An SBOM entry may be a build dependency. Resolve shipped/build-only scope and missing metadata against the native build; this is not a full native linkage inventory.' }
}

export async function reviewCodecEvidence(root) {
  const hash = async relative => createHash('sha256').update(await readFile(join(root, relative))).digest('hex')
  const names = ['electron', 'libheif-js', '@napi-rs/canvas', '@napi-rs/canvas-win32-x64-msvc', 'pdfjs-dist', 'tesseract.js', 'tesseract.js-core', '@tesseract.js-data/eng', '@tesseract.js-data/tur']
  const packages = []
  for (const name of names) {
    const relative = `node_modules/${name}/package.json`
    const p = JSON.parse(await readFile(join(root, relative), 'utf8'))
    packages.push({ name, version: p.version, declaredLicense: p.license, packageMetadataSha256: await hash(relative) })
  }
  // Upstream source/build references below were reviewed for these exact versions.
  for (const [name, version] of Object.entries({ electron: '44.9.1', 'libheif-js': '1.23.5', '@napi-rs/canvas': '1.0.12', '@napi-rs/canvas-win32-x64-msvc': '1.0.12' })) {
    if (packages.find(p => p.name === name)?.version !== version) throw new Error('Codec source/build evidence must be refreshed for ' + name)
  }
  const sbomPath = 'node_modules/@napi-rs/canvas-win32-x64-msvc/sbom.cdx.json'
  const nativeEvidence = JSON.parse(await readFile(join(root, 'services/file-agent/codec-license-evidence.json'), 'utf8'))
  if (nativeEvidence.upstreamSbomSha256 !== await hash(sbomPath)) throw new Error('Native license supplement must be refreshed for the installed SBOM')
  return { status: 'OPEN_COMMERCIAL_EVIDENCE_GAPS', checkedAt: new Date().toISOString(), packages,
    fingerprints: { lock: await hash('package-lock.json'), ffmpeg: await hash('node_modules/electron/dist/ffmpeg.dll'),
      chromiumNotices: await hash('node_modules/electron/dist/LICENSES.chromium.html'),
      canvasBinary: await hash('node_modules/@napi-rs/canvas-win32-x64-msvc/skia.win32-x64-msvc.node'),
      nativeSbom: await hash(sbomPath), fileAgentNotices: await hash('services/file-agent/THIRD-PARTY-NOTICES.txt') },
    native: reviewNativeSbom(JSON.parse(await readFile(join(root, sbomPath), 'utf8')), nativeEvidence),
    missingCommercialEvidence: [
      { dependency: 'Electron / Chromium FFmpeg', evidence: 'Shipped DLL and Chromium notices fingerprinted; Electron MIT alone does not cover embedded codecs.',
        required: ['Exact FFmpeg corresponding source/build flags and toolchain tied to this DLL', 'Recipient source delivery/access and applicable LGPL notices', 'Replacement/relink validation for the shipped combination', 'Country/use/distribution-specific AVC/AAC/other enabled codec patent applicability decision'],
        references: ['https://github.com/electron/electron/blob/v44.9.1/build/args/all.gn', 'https://www.ffmpeg.org/legal.html'] },
      { dependency: 'libheif-js / embedded libheif and libde265', evidence: 'libheif-js declares LGPL-3.0; existing notice pins libheif build and libde265 1.0.15 LGPL-3.0-or-later. Decoder linkage is from the upstream recipe, not an independently reproduced binary.',
        required: ['Archive exact corresponding source including libde265, build scripts, Emscripten 3.1.61 and build dependencies', 'Demonstrate rebuilt/replaced JS/WASM works with the application and deliver required relink material', 'Recipient-facing source access and license/notice delivery proof', 'HEVC patent applicability/rights decision for intended territories and use'],
        references: ['https://github.com/catdad-experiments/libheif-js/tree/d8ec4bc3bc5bf8055975577bccbbc7e1d7313c2d', 'https://github.com/strukturag/libheif/blob/413e2a87e6a70b3eccc3a3adc5801179dd2d9e00/build-emscripten.sh', 'https://www.gnu.org/licenses/lgpl-3.0.html'] },
      { dependency: '@napi-rs/canvas / Skia / native image codecs', evidence: 'Package MIT and pinned native SBOM; codec and MPL rows listed separately.',
        required: ['Resolve every missing SBOM license and identify build-only versus distributed components', 'Exact MPL covered source access and recipient source notices for applicable cssparser/cssparser-macros/dtoa-short/selectors', 'Retain codec notices for JPEG-turbo (BSD/IJG/Zlib), PNG, WebP, AVIF/AOM and their nested sources', 'Confirm native linkage inventory beyond Rust SBOM and evaluate applicable codec patent grants/limitations'],
        references: ['https://github.com/Brooooooklyn/canvas/tree/v1.0.12', 'https://www.mozilla.org/en-US/MPL/2.0/'] },
      { dependency: 'pdfjs-dist / Tesseract JS/core / language data', evidence: 'Installed package license declarations captured separately; they do not license external native codecs.',
        required: ['Verify Apache-2.0 LICENSE/NOTICE and MIT data attributions in the final customer distribution; package declarations alone are insufficient', 'Tie embedded WASM/native dependency notices and actual traineddata versions to the customer artifact'], references: [] },
    ], legalClearanceClaimed: false, patentRoyaltyObligationAsserted: false, productionMutations: 0 }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [destination, ...extra] = process.argv.slice(2)
  if (!destination || extra.length) throw new Error('Usage: node scripts/review-codec-evidence.mjs <new-report.json>')
  const report = await reviewCodecEvidence(resolve('.'))
  await writeFile(destination, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ status: report.status, packages: report.packages.length, missingNativeLicenses: report.native.missingLicenseMetadata.length, mplComponents: report.native.mplSourceNoticeRequired.length }))
}
