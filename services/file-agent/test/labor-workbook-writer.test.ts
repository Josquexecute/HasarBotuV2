import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import { sha256WorkbookBytes } from '../src/ooxml-readonly-extractor.js'
import {
  applyLaborWorkbookWrite,
  previewLaborWorkbookWrite,
  type LaborWorkbookWriteAuditEvent,
} from '../src/labor-workbook-writer.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(async (directory) => {
    await rm(directory, { recursive: true, force: true })
  }))
})

const xml = (body: string): Uint8Array =>
  strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${body}`)

function fixtureWorkbook(options: {
  readonly plate?: string
  readonly macro?: boolean
  readonly externalRelationship?: boolean
  readonly d2Formula?: boolean
  readonly coreTitle?: string
} = {}): Uint8Array {
  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': xml(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + (options.macro === true
        ? '<Override PartName="/xl/vbaProject.bin" '
          + 'ContentType="application/vnd.ms-office.vbaProject"/>'
        : '')
      + '</Types>',
    ),
    '_rels/.rels': xml(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rootBook" '
      + 'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
      + 'Target="xl/workbook.xml"/>'
      + '</Relationships>',
    ),
    'xl/workbook.xml': xml(
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
      + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<sheets><sheet name="İşçilik" sheetId="1" r:id="sheetRel"/></sheets>'
      + '</workbook>',
    ),
    'xl/_rels/workbook.xml.rels': xml(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="sheetRel" '
      + 'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
      + 'Target="worksheets/labor.xml"/>'
      + (options.externalRelationship === true
        ? '<Relationship Id="external" Type="x/hyperlink" '
          + 'Target="https://example.invalid/" TargetMode="External"/>'
        : '')
      + '</Relationships>',
    ),
    'xl/worksheets/labor.xml': xml(
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + '<sheetData>'
      + '<row r="1">'
      + '<c r="A1" t="inlineStr"><is><t>Parça</t></is></c>'
      + `<c r="B1" t="inlineStr"><is><t>${options.plate ?? '34 TEST 34'}</t></is></c>`
      + '<c r="D1" t="inlineStr"><is><t>Parça Kodu</t></is></c>'
      + '<c r="H1" t="inlineStr"><is><t>Kaporta</t></is></c>'
      + '<c r="N1" t="inlineStr"><is><t>Onarım</t></is></c>'
      + '</row>'
      + '<row r="2">'
      + '<c r="A2" t="inlineStr"><is><t>Ön tampon</t></is></c>'
      + (options.d2Formula === true
        ? '<c r="D2"><f>UPPER(A2)</f><v>ESKİ</v></c>'
        : '<c s="4" r="D2" t="inlineStr"><is><t>ESKİ</t></is></c>')
      + '<c r="H2" s="7"><v>125.50</v></c>'
      + '<c r="I2" s="7"><v>20.00</v></c>'
      + '<c r="J2" s="7"><v>30.00</v></c>'
      + '<c r="K2" s="7"><v>40.00</v></c>'
      + '<c r="L2" s="7"><v>50.00</v></c>'
      + '<c r="M2" s="7"><v>60.00</v></c>'
      + '<c r="N2" s="8"><f>SUM(H2:M2)</f><v>325.50</v></c>'
      + '</row>'
      + '<row r="3"><c r="A3" t="inlineStr"><is><t>Kapı</t></is></c></row>'
      + '</sheetData></worksheet>',
    ),
    'docProps/core.xml': xml(
      `<coreProperties><title>${options.coreTitle ?? 'Sentetik'}</title></coreProperties>`,
    ),
  }
  if (options.macro === true) entries['xl/vbaProject.bin'] = strToU8('sentetik-vba')
  return zipSync(entries)
}

const signature = {
  sheetName: 'İşçilik',
  headers: [
    { cell: 'A1', text: 'Parça' },
    { cell: 'D1', text: 'Parça Kodu' },
  ],
  identityCells: [{ cell: 'B1', text: '34 TEST 34' }],
} as const

async function fixture(bytes = fixtureWorkbook()): Promise<{
  readonly root: string
  readonly relativePath: string
  readonly absolutePath: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'hasarbotu-workbook-write-'))
  temporaryDirectories.push(root)
  const relativePath = 'sentetik-işçilik.xlsx'
  const absolutePath = join(root, relativePath)
  await writeFile(absolutePath, bytes)
  return { root, relativePath, absolutePath }
}

async function preview(input: Awaited<ReturnType<typeof fixture>>) {
  return await previewLaborWorkbookWrite({
    rootAbsolute: input.root,
    relativeWorkbookPath: input.relativePath,
    signature,
    changes: [
      { cell: 'D2', newValue: 'PRC-001' },
      { cell: 'D3', newValue: 'PRC-002' },
    ],
    now: () => new Date('2026-07-23T12:00:00.000Z'),
  })
}

function approval(planHash: string) {
  return {
    confirmed: true,
    planHash,
    approvedByUserId: '00000000-0000-7000-8000-000000000001',
    approvedAt: '2026-07-23T12:01:00.000Z',
  } as const
}

describe('Paket 65B — güvenli İşçilik workbook fiziksel yazım katmanı', () => {
  it('salt-okunur değişiklik önizlemesi üretir ve kaynağa dokunmaz', async () => {
    const input = await fixture()
    const before = await readFile(input.absolutePath)
    const result = await preview(input)

    expect(result).toMatchObject({
      ok: true,
      relativeWorkbookPath: input.relativePath,
      targetSheetName: 'İşçilik',
      targetWorksheetPart: 'xl/worksheets/labor.xml',
      sourceSha256: sha256WorkbookBytes(before),
      changes: [
        { cell: 'D2', previousValue: 'ESKİ', newValue: 'PRC-001' },
        { cell: 'D3', previousValue: null, newValue: 'PRC-002' },
      ],
    })
    expect(await readFile(input.absolutePath)).toEqual(before)
    expect(await readdir(input.root)).toEqual([input.relativePath])
  })

  it('D dışındaki hücreyi, başlık/kimlik hücresini ve formül hücresini fail-closed reddeder', async () => {
    const input = await fixture()
    const before = await readFile(input.absolutePath)

    await expect(previewLaborWorkbookWrite({
      rootAbsolute: input.root,
      relativeWorkbookPath: input.relativePath,
      signature,
      changes: [{ cell: 'H2', newValue: 'YASAK' }],
    })).resolves.toMatchObject({ ok: false, code: 'WORKBOOK_WRITE_COLUMN_FORBIDDEN' })

    await expect(previewLaborWorkbookWrite({
      rootAbsolute: input.root,
      relativeWorkbookPath: input.relativePath,
      signature,
      changes: [{ cell: 'D1', newValue: 'YASAK' }],
    })).resolves.toMatchObject({ ok: false, code: 'WORKBOOK_WRITE_SIGNATURE_CELL_FORBIDDEN' })

    const formula = await fixture(fixtureWorkbook({ d2Formula: true }))
    await expect(previewLaborWorkbookWrite({
      rootAbsolute: formula.root,
      relativeWorkbookPath: formula.relativePath,
      signature,
      changes: [{ cell: 'D2', newValue: 'YASAK' }],
    })).resolves.toMatchObject({ ok: false, code: 'WORKBOOK_WRITE_CELL_FORMULA' })
    expect(await readFile(input.absolutePath)).toEqual(before)
  })

  it('yanlış plaka, makro ve external relationship halinde preflight geçmez', async () => {
    const wrongPlate = await fixture(fixtureWorkbook({ plate: '06 BAŞKA 06' }))
    await expect(preview(wrongPlate)).resolves.toMatchObject({
      ok: false,
      code: 'WORKBOOK_SIGNATURE_MISMATCH',
      detail: 'B1',
    })

    const macro = await fixture(fixtureWorkbook({ macro: true }))
    await expect(preview(macro)).resolves.toMatchObject({
      ok: false,
      code: 'WORKBOOK_VBA_PROJECT',
    })

    const external = await fixture(fixtureWorkbook({ externalRelationship: true }))
    await expect(preview(external)).resolves.toMatchObject({
      ok: false,
      code: 'WORKBOOK_EXTERNAL_LINK',
    })
  })

  it('açık onay veya plan hash eşleşmesi olmadan backup/temp/yazım yapmaz', async () => {
    const input = await fixture()
    const before = await readFile(input.absolutePath)
    const plan = await preview(input)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return

    const missingApproval = await applyLaborWorkbookWrite({
      rootAbsolute: input.root,
      relativeWorkbookPath: input.relativePath,
      signature,
      changes: plan.changes.map((change) => ({ cell: change.cell, newValue: change.newValue })),
      preview: plan,
      approval: { ...approval(plan.planHash), approvedByUserId: '' },
      hooks: { recordAudit: async () => undefined },
    })
    expect(missingApproval).toMatchObject({
      ok: false,
      code: 'WORKBOOK_WRITE_APPROVAL_REQUIRED',
      sourcePreserved: true,
    })

    const mismatch = await applyLaborWorkbookWrite({
      rootAbsolute: input.root,
      relativeWorkbookPath: input.relativePath,
      signature,
      changes: plan.changes.map((change) => ({ cell: change.cell, newValue: change.newValue })),
      preview: plan,
      approval: { ...approval(plan.planHash), planHash: '0'.repeat(64) },
      hooks: { recordAudit: async () => undefined },
    })
    expect(mismatch).toMatchObject({
      ok: false,
      code: 'WORKBOOK_WRITE_APPROVAL_MISMATCH',
      sourcePreserved: true,
    })
    expect(await readFile(input.absolutePath)).toEqual(before)
    expect(await readdir(input.root)).toEqual([input.relativePath])
  })

  it('backup → temp → doğrula → atomik replace yapar; yalnız D hücreleri değişir', async () => {
    const input = await fixture()
    const before = await readFile(input.absolutePath)
    const beforeArchive = unzipSync(before)
    const plan = await preview(input)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    const audit: LaborWorkbookWriteAuditEvent[] = []

    const result = await applyLaborWorkbookWrite({
      rootAbsolute: input.root,
      relativeWorkbookPath: input.relativePath,
      signature,
      changes: plan.changes.map((change) => ({ cell: change.cell, newValue: change.newValue })),
      preview: plan,
      approval: approval(plan.planHash),
      now: () => new Date('2026-07-23T12:02:03.456Z'),
      hooks: { recordAudit: async (event) => { audit.push(event) } },
    })

    expect(result).toMatchObject({
      ok: true,
      startSha256: sha256WorkbookBytes(before),
      backupFileName: expect.stringMatching(
        /^sentetik-işçilik\.20260723T120203456Z\.[a-f0-9]{12}\.bak\.xlsx$/,
      ),
      cells: ['D2', 'D3'],
    })
    if (!result.ok) return

    const after = await readFile(input.absolutePath)
    const afterArchive = unzipSync(after)
    expect(result.resultSha256).toBe(sha256WorkbookBytes(after))
    expect(await readFile(join(input.root, result.backupFileName))).toEqual(before)
    expect(Object.keys(afterArchive).sort()).toEqual(Object.keys(beforeArchive).sort())
    for (const name of Object.keys(beforeArchive)) {
      if (name !== 'xl/worksheets/labor.xml') {
        expect(afterArchive[name]).toEqual(beforeArchive[name])
      }
    }
    const sheet = strFromU8(afterArchive['xl/worksheets/labor.xml'] as Uint8Array)
    expect(sheet).toContain('<c r="D2" s="4" t="inlineStr"><is><t xml:space="preserve">PRC-001</t></is></c>')
    expect(sheet).toContain('<c r="D3" t="inlineStr"><is><t xml:space="preserve">PRC-002</t></is></c>')
    for (const cell of ['H2', 'I2', 'J2', 'K2', 'L2', 'M2', 'N2']) {
      const beforeCell = new RegExp(`<c r="${cell}"[\\s\\S]*?</c>`).exec(
        strFromU8(beforeArchive['xl/worksheets/labor.xml'] as Uint8Array),
      )?.[0]
      const afterCell = new RegExp(`<c r="${cell}"[\\s\\S]*?</c>`).exec(sheet)?.[0]
      expect(afterCell).toBe(beforeCell)
    }
    expect(audit.map((event) => event.phase)).toEqual(['started', 'completed'])
    expect(audit[0]).toMatchObject({
      startSha256: result.startSha256,
      resultSha256: null,
      cells: ['D2', 'D3'],
    })
    expect(audit[1]).toMatchObject({
      startSha256: result.startSha256,
      resultSha256: result.resultSha256,
      backupFileName: result.backupFileName,
    })
    expect((await readdir(input.root)).some((name) => name.includes('.tmp.xlsx'))).toBe(false)
    expect((await readdir(input.root)).some((name) => name.endsWith('.lock'))).toBe(false)
  })

  it('atomik replace öncesi hatada kaynak byte-for-byte korunur', async () => {
    const input = await fixture()
    const before = await readFile(input.absolutePath)
    const plan = await preview(input)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    const audit: LaborWorkbookWriteAuditEvent[] = []

    const result = await applyLaborWorkbookWrite({
      rootAbsolute: input.root,
      relativeWorkbookPath: input.relativePath,
      signature,
      changes: plan.changes.map((change) => ({ cell: change.cell, newValue: change.newValue })),
      preview: plan,
      approval: approval(plan.planHash),
      hooks: {
        recordAudit: async (event) => { audit.push(event) },
        beforeAtomicReplace: async () => { throw new Error('sentetik-replace-hatası') },
      },
    })

    expect(result).toMatchObject({
      ok: false,
      code: 'WORKBOOK_WRITE_REPLACE_FAILED',
      sourcePreserved: true,
      startSha256: sha256WorkbookBytes(before),
      resultSha256: sha256WorkbookBytes(before),
    })
    expect(await readFile(input.absolutePath)).toEqual(before)
    expect(audit.map((event) => event.phase)).toEqual(['started', 'failed'])
  })

  it('replace sonrası doğrulama/audit hatasında backup üzerinden atomik rollback yapar', async () => {
    const input = await fixture()
    const before = await readFile(input.absolutePath)
    const plan = await preview(input)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return

    const postReplace = await applyLaborWorkbookWrite({
      rootAbsolute: input.root,
      relativeWorkbookPath: input.relativePath,
      signature,
      changes: plan.changes.map((change) => ({ cell: change.cell, newValue: change.newValue })),
      preview: plan,
      approval: approval(plan.planHash),
      hooks: {
        recordAudit: async () => undefined,
        afterAtomicReplace: async () => { throw new Error('sentetik-post-replace-hatası') },
      },
    })
    expect(postReplace).toMatchObject({
      ok: false,
      code: 'WORKBOOK_WRITE_VERIFICATION_FAILED',
      sourcePreserved: true,
    })
    expect(await readFile(input.absolutePath)).toEqual(before)

    const freshPlan = await preview(input)
    expect(freshPlan.ok).toBe(true)
    if (!freshPlan.ok) return
    const auditFailure = await applyLaborWorkbookWrite({
      rootAbsolute: input.root,
      relativeWorkbookPath: input.relativePath,
      signature,
      changes: freshPlan.changes.map((change) => ({ cell: change.cell, newValue: change.newValue })),
      preview: freshPlan,
      approval: approval(freshPlan.planHash),
      hooks: {
        recordAudit: async (event) => {
          if (event.phase === 'completed') throw new Error('sentetik-audit-hatası')
        },
      },
    })
    expect(auditFailure).toMatchObject({
      ok: false,
      code: 'WORKBOOK_WRITE_AUDIT_FAILED',
      sourcePreserved: true,
      resultSha256: sha256WorkbookBytes(before),
    })
    expect(await readFile(input.absolutePath)).toEqual(before)
  })

  it('aynı workbook için eşzamanlı ikinci yazımı kilitle engeller', async () => {
    const input = await fixture()
    const plan = await preview(input)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return

    let releaseReplace: (() => void) | undefined
    let enteredReplace: (() => void) | undefined
    const entered = new Promise<void>((resolvePromise) => { enteredReplace = resolvePromise })
    const release = new Promise<void>((resolvePromise) => { releaseReplace = resolvePromise })
    const applyInput = {
      rootAbsolute: input.root,
      relativeWorkbookPath: input.relativePath,
      signature,
      changes: plan.changes.map((change) => ({ cell: change.cell, newValue: change.newValue })),
      preview: plan,
      approval: approval(plan.planHash),
    } as const
    const first = applyLaborWorkbookWrite({
      ...applyInput,
      hooks: {
        recordAudit: async () => undefined,
        beforeAtomicReplace: async () => {
          enteredReplace?.()
          await release
        },
      },
    })
    await entered

    const second = await applyLaborWorkbookWrite({
      ...applyInput,
      hooks: { recordAudit: async () => undefined },
    })
    expect(second).toMatchObject({
      ok: false,
      code: 'WORKBOOK_WRITE_LOCKED',
      sourcePreserved: true,
    })

    releaseReplace?.()
    await expect(first).resolves.toMatchObject({ ok: true })
  })

  it('önizlemeden sonra kaynak değişirse eski planı bayat sayar ve yeni kaynağı korur', async () => {
    const input = await fixture()
    const plan = await preview(input)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    const changed = fixtureWorkbook({ coreTitle: 'Sentetik değişti' })
    await writeFile(input.absolutePath, changed)

    const result = await applyLaborWorkbookWrite({
      rootAbsolute: input.root,
      relativeWorkbookPath: input.relativePath,
      signature,
      changes: plan.changes.map((change) => ({ cell: change.cell, newValue: change.newValue })),
      preview: plan,
      approval: approval(plan.planHash),
      hooks: { recordAudit: async () => undefined },
    })
    expect(result).toMatchObject({ ok: false, code: 'WORKBOOK_SIZE_MISMATCH' })
    expect(await readFile(input.absolutePath)).toEqual(Buffer.from(changed))
    expect((await readdir(input.root)).filter((name) => name.endsWith('.bak.xlsx'))).toEqual([])
  })
})
