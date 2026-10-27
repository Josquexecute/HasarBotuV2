import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const digest = bytes => createHash('sha256').update(bytes).digest('hex')

// Read authenticated crate archives in memory; never extract archive paths onto disk.
export function crateFiles(archive) {
  const tar = gunzipSync(archive, { maxOutputLength: 32 * 1048576 }), files = new Map()
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
    const size = Number.parseInt(header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim(), 8)
    assert.ok(Number.isSafeInteger(size) && size >= 0 && offset + 512 + size <= tar.length, 'Invalid archive size')
    if (header[156] === 0 || header[156] === 48) files.set(name, tar.subarray(offset + 512, offset + 512 + size))
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return files
}

export function registryLicenseEvidence(component, archive) {
  const expected = component.hashes?.find(h => h.alg === 'SHA-256')?.content
  assert.equal(digest(archive), expected, 'Crate bytes must match the shipped upstream SBOM checksum')
  const files = crateFiles(archive), base = `${component.name}-${component.version}/`
  const cargo = files.get(base + 'Cargo.toml')?.toString('utf8')
  assert.ok(cargo, 'Normalized Cargo.toml required')
  const licenseExpression = /^license\s*=\s*"([^"]+)"/m.exec(cargo)?.[1]
  assert.ok(licenseExpression, 'Explicit crate license declaration required')
  const licenseFiles = [...files].filter(([path]) => path.startsWith(base) && /\/(LICENSE[^/]*|COPYING[^/]*)$/.test(path))
    .map(([path, bytes]) => ({ path, sha256: digest(bytes) }))
  assert.ok(licenseFiles.length, 'Actual license text must accompany a metadata resolution')
  return { bomRef: component['bom-ref'], name: component.name, version: component.version, status: 'VERIFIED_REGISTRY_LICENSE',
    licenseExpression, archiveSha256: expected, sourceUrl: `https://static.crates.io/crates/${component.name}/${component.name}-${component.version}.crate`, licenseFiles }
}

export async function completeNativeLicenseEvidence(sourceDirectory) {
  const sbomBytes = await readFile('node_modules/@napi-rs/canvas-win32-x64-msvc/sbom.cdx.json')
  const sbom = JSON.parse(sbomBytes), names = ['anstyle', 'clap', 'clap_builder', 'clap_lex', 'cxxbridge-cmd', 'strsim']
  const resolutions = []
  for (const name of names) {
    const c = sbom.components.find(c => c.name === name)
    assert.ok(c && !c.licenses?.length, 'Expected unresolved upstream entry')
    resolutions.push(registryLicenseEvidence(c, await readFile(join(sourceDirectory, `${name}-${c.version}.crate`))))
  }
  const native = await readFile('node_modules/@napi-rs/canvas-win32-x64-msvc/skia.win32-x64-msvc.node')
  const file = sbom.components.find(c => c.type === 'file' && c.name === 'skia.win32-x64-msvc.node')
  assert.equal(digest(native), file.hashes.find(h => h.alg === 'SHA-256').content)
  const projectLicense = await readFile(join(sourceDirectory, 'canvas-LICENSE'))
  const skiaLicense = await readFile(join(sourceDirectory, 'skia-LICENSE'))
  const manifest = await readFile(join(sourceDirectory, 'canvas-crates_skia-fontations_Cargo.toml'), 'utf8')
  const ffi = await readFile(join(sourceDirectory, 'skia-src_ports_fontations_src_ffi.rs'), 'utf8')
  assert.match(manifest, /path\s*=\s*"\.\.\/\.\.\/skia\/src\/ports\/fontations\/src\/ffi.rs"/)
  assert.match(ffi, /Copyright 2023 Google LLC/)
  assert.match(projectLicense.toString('utf8'), /MIT License/)
  assert.match(skiaLicense.toString('utf8'), /Redistribution and use in source and binary forms/)
  return { schemaVersion: 'native-license-evidence/1', upstreamSbomSha256: digest(sbomBytes), upstreamSbomModified: false, resolutions,
    classifiedEntries: [
      { bomRef: 'pkg:cargo/canvas@0.1.0', status: 'PROJECT_LICENSE_IDENTIFIED', licenseExpression: 'MIT',
        sourceUrl: 'https://github.com/Brooooooklyn/canvas/blob/a89b3c9d49145526046dd42603064ce267c5ed58/LICENSE', licenseSha256: digest(projectLicense),
        limitation: 'Root project license; embedded libraries retain their own licenses.' },
      { bomRef: 'pkg:cargo/skia-fontations@0.0.0', status: 'SOURCE_AND_TARGET_SCOPE_IDENTIFIED', licenseExpression: 'BSD-3-Clause',
        sourceUrl: 'https://github.com/google/skia/blob/b94213a11b3a2edadfae89f0c57a7f4ab72772c9/src/ports/fontations/src/ffi.rs', licenseSha256: digest(skiaLicense),
        scope: 'Cargo target dependency is macOS/Linux only; the shipped Windows SBOM enumerates the all-target Cargo.lock. Native binary linkage has not been independently reproduced.' },
      { bomRef: file['bom-ref'], status: 'AGGREGATE_BINARY_IDENTIFIED', binarySha256: digest(native),
        limitation: 'Aggregate file is governed by package and embedded-component licenses. No single MIT license is assigned to the whole binary; native closure and distribution proof remain open.' },
    ], unresolvedCommercialRequirements: ['Native build/linkage reproduction', 'Recipient-facing license/source delivery', 'Applicable patent rights'], legalClearanceClaimed: false }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [sourceDirectory, output, ...extra] = process.argv.slice(2)
  assert.ok(sourceDirectory && output && !extra.length, 'Expected source directory and new output JSON')
  const evidence = await completeNativeLicenseEvidence(sourceDirectory)
  await writeFile(output, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ verifiedRegistryLicenses: evidence.resolutions.length, classifiedEntries: evidence.classifiedEntries.length, legalClearanceClaimed: false }))
}
