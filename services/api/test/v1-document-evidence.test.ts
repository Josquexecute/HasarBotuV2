import { createHash } from 'node:crypto'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ getDocument: ({ data }: { data: Uint8Array }) => {
  // Reproduce the real PDF worker ownership transfer, which empties the caller's view.
  structuredClone(data, { transfer: [data.buffer] })
  return { promise: Promise.resolve({ numPages: 1, getPage: async () => ({ getTextContent: async () => ({ items: [{ str: 'KASKO SIGORTA POLICESI POLICE NO 123 SIGORTALI TEST' }] }) }) }), destroy: async () => {} }
} }))
import { scanV1ClaimTypeDocumentEvidence } from '../src/v1-import/document-evidence.js'

describe('V1 document source hash', () => {
  it('hashes the source before the PDF worker detaches its buffer and preserves the file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hb-pdf-evidence-'))
    const bytes = Buffer.from('%PDF synthetic worker-transfer fixture')
    try {
      await writeFile(join(directory, 'policy.pdf'), bytes)
      const result = await scanV1ClaimTypeDocumentEvidence({ folderAbsolutePath: directory, folderRelativePath: '2026/34AAA123' })
      expect(result.scanState).toBe('complete')
      expect(result.evidence).toHaveLength(1)
      expect(result.evidence[0]).toMatchObject({ kind: 'casco_policy_content', sourceFileHash: createHash('sha256').update(bytes).digest('hex'), extractionVersion: 'v1-claim-document-evidence/1.0.2' })
      expect(await readFile(join(directory, 'policy.pdf'))).toEqual(bytes)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
  it('reads definitive policy PDFs before applying the photo OCR limit', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hb-pdf-photo-archive-'))
    try {
      await writeFile(join(directory, 'policy.pdf'), '%PDF synthetic')
      for (let index = 0; index < 100; index++) await writeFile(join(directory, `damage-${index}.jpg`), 'not decoded because the PDF already contains policy evidence')
      const result = await scanV1ClaimTypeDocumentEvidence({ folderAbsolutePath: directory, folderRelativePath: '2026/34AAA123' })
      expect(result.scanState).toBe('complete')
      expect(result.evidence.map(e => e.kind)).toEqual(['casco_policy_content'])
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
  it('keeps the PDF work bound instead of processing an unlimited PDF archive', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hb-pdf-limit-'))
    try {
      for (let index = 0; index < 65; index++) await writeFile(join(directory, `policy-${index}.pdf`), '%PDF synthetic')
      expect(await scanV1ClaimTypeDocumentEvidence({ folderAbsolutePath: directory, folderRelativePath: '2026/34AAA123' })).toEqual({ scanState: 'failed', evidence: [] })
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})
