import { posix } from 'node:path'
import { unzipSync } from 'fflate'
import { SaxesParser, type SaxesTagPlain } from 'saxes'
import type { CaseFolderPreview } from '@hasarbotu/contracts'

const MAX_XML = 4 * 1024 * 1024
const MAX_PACKAGE_XML = 16 * 1024 * 1024
const MAX_SHEETS = 8
const MAX_ROWS = 60
const MAX_COLUMNS = 12
const MAX_CELL = 200
const MAX_WORD_TEXT = 64 * 1024

function readXml(bytes: Uint8Array | undefined, handlers: {
  open?: (name: string, attributes: SaxesTagPlain['attributes']) => void
  close?: (name: string) => void
  text?: (value: string) => void
}) {
  if (!bytes) throw new Error('Missing OOXML part')
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8'
  const local = (name: string) => name.split(':').at(-1)!
  const parser = new SaxesParser()
  let depth = 0
  parser.on('doctype', () => { throw new Error('OOXML DTD is not supported') })
  parser.on('opentag', tag => {
    if (++depth > 128) throw new Error('OOXML nesting limit')
    handlers.open?.(local(tag.name), tag.attributes)
  })
  parser.on('closetag', tag => { depth--; handlers.close?.(local(tag.name)) })
  if (handlers.text) {
    parser.on('text', handlers.text)
    parser.on('cdata', handlers.text)
  }
  parser.write(new TextDecoder(encoding, { fatal: true }).decode(bytes)).close()
}

function wordPreview(xml: Uint8Array | undefined): CaseFolderPreview {
  const paragraphs: string[] = []
  let paragraph = ''
  let size = 0
  let truncated = false
  let inText = false
  function append(value: string) {
    const remaining = MAX_WORD_TEXT - size
    paragraph += value.slice(0, remaining)
    size += Math.min(value.length, remaining)
    truncated ||= value.length > remaining
  }
  readXml(xml, {
    open(name) {
      if (name === 't') inText = true
      if (name === 'br') append('\n')
      if (name === 'tab') append('\t')
    },
    text(value) { if (inText) append(value) },
    close(name) {
      if (name === 't') inText = false
      if (name === 'p') {
        if (paragraph.trim()) paragraphs.push(paragraph)
        paragraph = ''
      }
    },
  })
  return { kind: 'word', paragraphs, truncated }
}

function workbookPreview(entries: Record<string, Uint8Array>): CaseFolderPreview {
  const workbook: { name: string; id: string }[] = []
  readXml(entries['xl/workbook.xml'], { open(name, attrs) {
    if (name === 'sheet' && attrs.name && attrs['r:id'] && (!attrs.state || attrs.state === 'visible')) {
      workbook.push({ name: attrs.name.slice(0, 100), id: attrs['r:id'] })
    }
  } })
  const parts = new Map<string, string>()
  readXml(entries['xl/_rels/workbook.xml.rels'], { open(name, attrs) {
    if (name !== 'Relationship' || !attrs.Id || !attrs.Target || attrs.TargetMode === 'External' || !attrs.Type?.endsWith('/worksheet')) return
    const path = attrs.Target.startsWith('/') ? posix.normalize(attrs.Target.slice(1)) : posix.join('xl', attrs.Target)
    if (path.startsWith('xl/') && path.endsWith('.xml') && !path.includes('\\')) parts.set(attrs.Id, path)
  } })

  const shared: { value: string; truncated: boolean }[] = []
  let text = ''
  let clipped = false
  let reading = false
  const append = (value: string) => {
    if (!reading) return
    const remaining = MAX_CELL - text.length
    text += value.slice(0, remaining)
    clipped ||= value.length > remaining
  }
  if (entries['xl/sharedStrings.xml']) readXml(entries['xl/sharedStrings.xml'], {
    open(name) { if (name === 'si') { text = ''; clipped = false } if (name === 't') reading = true },
    text: append,
    close(name) {
      if (name === 't') reading = false
      if (name === 'si') shared.push({ value: text, truncated: clipped })
    },
  })

  const visible = workbook.filter(sheet => parts.has(sheet.id))
  let truncated = visible.length > MAX_SHEETS
  const sheets = visible.slice(0, MAX_SHEETS).map(sheet => {
    const rows: string[][] = []
    let row = 0
    let column = 0
    let cellType = ''
    let inSheetData = false
    let inCell = false
    readXml(entries[parts.get(sheet.id)!], {
      open(name, attrs) {
        if (name === 'sheetData') inSheetData = true
        if (!inSheetData) return
        if (name === 'row') { row = Number(attrs.r ?? row + 1); column = 0 }
        if (name === 'c') {
          inCell = true
          const address = /^[A-Z]{1,3}/.exec(attrs.r ?? '')?.[0]
          column = address ? [...address].reduce((index, char) => index * 26 + char.charCodeAt(0) - 64, 0) : column + 1
          cellType = attrs.t ?? ''
          text = ''
          clipped = false
        }
        if (inCell && (name === 'v' || (name === 't' && cellType === 'inlineStr'))) reading = true
      },
      text: append,
      close(name) {
        if (name === 'v' || name === 't') reading = false
        if (name === 'sheetData') inSheetData = false
        if (name !== 'c' || !inCell) return
        inCell = false
        if (text === '') return
        if (!Number.isSafeInteger(row) || row < 1 || row > MAX_ROWS || column < 1 || column > MAX_COLUMNS) {
          truncated = true
          return
        }
        const string = cellType === 's' ? shared[Number(text)] : undefined
        truncated ||= clipped || !!string?.truncated
        while (rows.length < row) rows.push([])
        const cells = rows[row - 1]!
        while (cells.length < column) cells.push('')
        cells[column - 1] = cellType === 's' ? string?.value ?? '' : text
      },
    })
    const width = Math.max(1, ...rows.map(cells => cells.length))
    return { name: sheet.name, rows: rows.map(cells => Array.from({ length: width }, (_, index) => cells[index] ?? '')) }
  })
  return { kind: 'workbook', sheets, truncated }
}

export function extractOfficePreview(bytes: Uint8Array, format: 'docx' | 'xlsx'): CaseFolderPreview {
  let total = 0
  let count = 0
  const entries = unzipSync(bytes, { filter(entry) {
    if (++count > 4096) throw new Error('OOXML entry limit')
    const needed = format === 'docx' ? entry.name === 'word/document.xml'
      : /^xl\/(?:_rels\/workbook\.xml\.rels|workbook\.xml|sharedStrings\.xml|worksheets\/[\w.-]+\.xml)$/.test(entry.name)
    if (!needed) return false
    const size = Math.max(entry.size, entry.originalSize)
    total += size
    if (size > MAX_XML || total > MAX_PACKAGE_XML) throw new Error('OOXML preview size limit')
    return true
  } })
  return format === 'docx' ? wordPreview(entries['word/document.xml']) : workbookPreview(entries)
}
