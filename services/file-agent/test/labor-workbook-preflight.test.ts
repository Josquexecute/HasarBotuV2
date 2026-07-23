import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { strToU8, zipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import { sha256WorkbookBytes } from '../src/ooxml-readonly-extractor.js'
import {
  preflightLaborWorkbook,
  readZipCentralDirectory,
} from '../src/labor-workbook-preflight.js'

const temporaryDirectories: string[] = []
const xml = (body: string): Uint8Array =>
  strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${body}`)

function fixtureWorkbook(options: {
  readonly hidden?: boolean
  readonly externalLink?: boolean
  readonly externalRelationship?: boolean
  readonly header?: string
} = {}): Uint8Array {
  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': xml(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    ),
    '_rels/.rels': xml(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rootBook" '
      + 'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
      + 'Target="xl/book/workbook.xml"/>'
      + '</Relationships>',
    ),
    'xl/book/workbook.xml': xml(
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
      + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<sheets><sheet name="İşçilik" sheetId="1" '
      + `${options.hidden === true ? 'state="hidden" ' : ''}r:id="sheetRel"/>`
      + '</sheets></workbook>',
    ),
    'xl/book/_rels/workbook.xml.rels': xml(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="sheetRel" '
      + 'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
      + 'Target="../worksheets/not-guessed.xml"/>'
      + (options.externalRelationship === true
        ? '<Relationship Id="external" Type="x/hyperlink" '
          + 'Target="https://example.invalid/" TargetMode="External"/>'
        : '')
      + '</Relationships>',
    ),
    'xl/worksheets/not-guessed.xml': xml(
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + '<sheetData><row r="1">'
      + `<c r="A1" t="inlineStr"><is><t>${options.header ?? 'Parça'}</t></is></c>`
      + '<c r="B1" t="inlineStr"><is><t>34 TEST 34</t></is></c>'
      + '</row></sheetData></worksheet>',
    ),
  }
  if (options.externalLink === true) {
    entries['xl/externalLinks/externalLink1.xml'] = xml('<externalLink/>')
  }
  return zipSync(entries)
}

async function writeFixture(bytes = fixtureWorkbook()): Promise<{
  readonly root: string
  readonly relativePath: string
  readonly absolutePath: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'hasarbotu-labor-preflight-'))
  temporaryDirectories.push(root)
  const relativePath = 'sentetik-isçilik.xlsx'
  const absolutePath = join(root, relativePath)
  await writeFile(absolutePath, bytes)
  return { root, relativePath, absolutePath }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(async (directory) => {
    await rm(directory, { recursive: true, force: true })
  }))
})

const signature = {
  sheetName: 'İşçilik',
  headers: [{ cell: 'A1', text: 'Parça' }],
  identityCells: [{ cell: 'B1', text: '34 TEST 34' }],
} as const

describe('Paket 65A File Agent salt-okunur workbook preflight', () => {
  it('relationship ile çözülen sheet partını doğrular ve kaynak byte’larını değiştirmez', async () => {
    const source = fixtureWorkbook()
    const fixture = await writeFixture(source)
    const before = sha256WorkbookBytes(await readFile(fixture.absolutePath))

    const result = await preflightLaborWorkbook({
      rootAbsolute: fixture.root,
      relativeWorkbookPath: fixture.relativePath,
      expectedSha256: before,
      expectedSize: source.byteLength,
      signature,
    })

    expect(result).toMatchObject({
      ok: true,
      sha256: before,
      size: source.byteLength,
      workbookPartName: 'xl/book/workbook.xml',
      targetWorksheetPart: 'xl/worksheets/not-guessed.xml',
      targetSheetName: 'İşçilik',
    })
    expect(sha256WorkbookBytes(await readFile(fixture.absolutePath))).toBe(before)
  })

  it('yanlış hash ve boyutta fail-closed davranır', async () => {
    const fixture = await writeFixture()
    const hashResult = await preflightLaborWorkbook({
      rootAbsolute: fixture.root,
      relativeWorkbookPath: fixture.relativePath,
      expectedSha256: '0'.repeat(64),
      signature,
    })
    expect(hashResult).toEqual({
      ok: false, code: 'WORKBOOK_HASH_MISMATCH', detail: null,
    })

    const sizeResult = await preflightLaborWorkbook({
      rootAbsolute: fixture.root,
      relativeWorkbookPath: fixture.relativePath,
      expectedSize: 1,
      signature,
    })
    expect(sizeResult).toEqual({
      ok: false, code: 'WORKBOOK_SIZE_MISMATCH', detail: null,
    })
  })

  it('içerik imzası uyuşmayan ve gizli hedef sheet için plan kaynağı üretmez', async () => {
    const mismatch = await writeFixture(fixtureWorkbook({ header: 'Başka tablo' }))
    expect(await preflightLaborWorkbook({
      rootAbsolute: mismatch.root,
      relativeWorkbookPath: mismatch.relativePath,
      signature,
    })).toEqual({
      ok: false, code: 'WORKBOOK_SIGNATURE_MISMATCH', detail: 'A1',
    })

    const hidden = await writeFixture(fixtureWorkbook({ hidden: true }))
    expect(await preflightLaborWorkbook({
      rootAbsolute: hidden.root,
      relativeWorkbookPath: hidden.relativePath,
      signature,
    })).toEqual({
      ok: false, code: 'WORKBOOK_TARGET_SHEET_HIDDEN', detail: null,
    })
  })

  it('harici bağlantılı workbook’u ve root traversal girişini reddeder', async () => {
    const external = await writeFixture(fixtureWorkbook({ externalLink: true }))
    expect(await preflightLaborWorkbook({
      rootAbsolute: external.root,
      relativeWorkbookPath: external.relativePath,
      signature,
    })).toEqual({
      ok: false, code: 'WORKBOOK_EXTERNAL_LINK', detail: null,
    })

    expect(await preflightLaborWorkbook({
      rootAbsolute: external.root,
      relativeWorkbookPath: '../outside.xlsx',
      signature,
    })).toEqual({
      ok: false, code: 'WORKBOOK_PATH_UNSAFE', detail: null,
    })

    const relationshipOnly = await writeFixture(fixtureWorkbook({ externalRelationship: true }))
    expect(await preflightLaborWorkbook({
      rootAbsolute: relationshipOnly.root,
      relativeWorkbookPath: relationshipOnly.relativePath,
      signature,
    })).toEqual({
      ok: false, code: 'WORKBOOK_EXTERNAL_LINK', detail: null,
    })
  })

  it('ZIP merkezi dizinini açmadan entry metadata’sını çıkarır', () => {
    const entries = readZipCentralDirectory(fixtureWorkbook())
    expect(entries.length).toBe(5)
    expect(entries.find((entry) => entry.name === 'xl/worksheets/not-guessed.xml'))
      .toMatchObject({ encrypted: false })
  })
})
