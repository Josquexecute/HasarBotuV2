import { Fragment, memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { CaseRecord } from '../../types/case'

const ESTIMATED_ROW_HEIGHT = 48
const OVERSCAN_ROWS = 8
const ROW_CONTROLS = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

/** Return the row containing a CSS-pixel offset, including unmeasured rows. */
function rowAt(offsets: readonly number[], offset: number): number {
  let low = 0, high = offsets.length - 1
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (offsets[middle] <= offset) low = middle
    else high = middle - 1
  }
  return Math.min(low, Math.max(0, offsets.length - 2))
}

interface RowOptions {
  'data-case-row': string
  'data-case-index': number
  'aria-rowindex': number
  onDialogChange: (open: boolean) => void
}

const MountedCaseRow = memo(function MountedCaseRow({ item, index, renderRow, onDialogChange }: {
  item: CaseRecord
  index: number
  renderRow: (item: CaseRecord, index: number, options: RowOptions) => ReactNode
  onDialogChange: (id: string, open: boolean) => void
}) {
  const dialogChanged = useCallback((open: boolean) => onDialogChange(item.caseId, open), [item.caseId, onDialogChange])
  return renderRow(item, index, { 'data-case-row': item.caseId, 'data-case-index': index, 'aria-rowindex': index + 2, onDialogChange: dialogChanged })
})

/** Keep native table geometry while bounding the number of mounted row controls. */
export function WindowedCaseRows({ items, columns, initialScrollTop = 0, initialRowHeights, onHeightsChange, children }: {
  items: readonly CaseRecord[]
  columns: number
  initialScrollTop?: number
  initialRowHeights?: ReadonlyMap<string, number>
  onHeightsChange?: (heights: ReadonlyMap<string, number>) => void
  children: (item: CaseRecord, index: number, options: RowOptions) => ReactNode
}) {
  const measurable = typeof ResizeObserver !== 'undefined'
  const body = useRef<HTMLTableSectionElement>(null)
  const observer = useRef<ResizeObserver | null>(null)
  const observedRows = useRef(new Set<Element>())
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(() => initialRowHeights ?? new Map())
  const [range, setRange] = useState(() => ({
    start: measurable ? Math.max(0, Math.floor(initialScrollTop / ESTIMATED_ROW_HEIGHT) - OVERSCAN_ROWS) : 0,
    end: measurable ? Math.min(items.length, Math.ceil((initialScrollTop + window.innerHeight) / ESTIMATED_ROW_HEIGHT) + OVERSCAN_ROWS) : items.length,
  }))
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [dialogId, setDialogId] = useState<string | null>(null)
  const [focusRequest, setFocusRequest] = useState<{ index: number; last: boolean } | null>(null)
  const dialogChanged = useCallback((id: string, open: boolean) => {
    if (!open) setFocusedId(id)
    setDialogId(open ? id : null)
  }, [])
  const estimatedHeight = useMemo(() => {
    // Wrapping can only grow a native row. Sparse tall exceptions must never
    // inflate the estimated height of ordinary, unseen preceding rows.
    let minimum = Infinity
    for (const height of heights.values()) minimum = Math.min(minimum, height)
    return Number.isFinite(minimum) ? minimum : ESTIMATED_ROW_HEIGHT
  }, [heights])
  const offsets = useMemo(() => {
    const result = [0]
    for (const item of items) result.push(result.at(-1)! + (heights.get(item.caseId) ?? estimatedHeight))
    return result
  }, [estimatedHeight, heights, items])

  useLayoutEffect(() => { onHeightsChange?.(heights) }, [heights, onHeightsChange])

  const updateRange = useCallback(() => {
    const element = body.current?.closest<HTMLDivElement>('.table-scroll')
    if (!element || !measurable) return
    const header = body.current?.parentElement?.querySelector('thead')?.getBoundingClientRect().height ?? 36
    const start = Math.max(0, rowAt(offsets, Math.max(0, element.scrollTop - header)) - OVERSCAN_ROWS)
    const end = Math.min(items.length, rowAt(offsets, Math.max(0, element.scrollTop + (element.clientHeight || window.innerHeight) - header)) + OVERSCAN_ROWS + 1)
    setRange(previous => previous.start === start && previous.end === end ? previous : { start, end })
  }, [items.length, measurable, offsets])

  useLayoutEffect(() => {
    const element = body.current?.closest<HTMLDivElement>('.table-scroll')
    if (!element || !measurable) return
    const resize = new ResizeObserver(entries => {
      const measured = entries.flatMap(entry => {
        const row = entry.target as HTMLTableRowElement
        const id = row.dataset.caseRow
        const height = entry.borderBoxSize?.[0]?.blockSize ?? row.getBoundingClientRect().height
        return id && height > 0 ? [[id, height] as const] : []
      })
      if (measured.length) setHeights(previous => {
        // A normal newly mounted row cannot change offsets. Retain the initial
        // sample and height exceptions without rebuilding geometry on every scroll.
        const changed = measured.filter(([id, height]) => previous.size === 0 || Math.abs((previous.get(id) ?? estimatedHeight) - height) > 0.5)
        if (!changed.length) return previous
        const next = new Map(previous)
        for (const [id, height] of changed) next.set(id, height)
        return next
      })
      updateRange()
    })
    observer.current = resize
    resize.observe(element)
    const header = body.current?.parentElement?.querySelector('thead')
    if (header) resize.observe(header)
    element.addEventListener('scroll', updateRange, { passive: true })
    updateRange()
    return () => {
      element.removeEventListener('scroll', updateRange)
      resize.disconnect()
      observer.current = null
      observedRows.current.clear()
    }
  }, [estimatedHeight, measurable, updateRange])

  useLayoutEffect(() => {
    const resize = observer.current
    if (!resize) return
    const rows = new Set(body.current?.querySelectorAll('[data-case-row]'))
    for (const row of observedRows.current) if (!rows.has(row)) resize.unobserve(row)
    for (const row of rows) if (!observedRows.current.has(row)) resize.observe(row)
    observedRows.current = rows
  })

  useLayoutEffect(() => {
    if (!focusRequest) return
    const row = body.current?.querySelector<HTMLTableRowElement>(`[data-case-index="${focusRequest.index}"]`)
    if (!row) return
    const controls = [...row.querySelectorAll<HTMLElement>(ROW_CONTROLS)].filter(control => control.tabIndex >= 0)
    const target = focusRequest.last ? controls.at(-1) ?? row : row
    target.focus({ preventScroll: true })
    setFocusRequest(null)
  }, [focusRequest])

  const focusRow = (index: number, last = false) => {
    const element = body.current?.closest<HTMLDivElement>('.table-scroll')
    if (!element || index < 0 || index >= items.length) return
    const header = body.current?.parentElement?.querySelector('thead')?.getBoundingClientRect().height ?? 36
    const top = offsets[index], bottom = offsets[index + 1] + header
    if (top < element.scrollTop) element.scrollTop = top
    else if (bottom > element.scrollTop + element.clientHeight) element.scrollTop = Math.max(0, bottom - element.clientHeight)
    setFocusedId(items[index].caseId)
    setFocusRequest({ index, last })
    updateRange()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTableSectionElement>) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || !(event.target instanceof Element)) return
    const row = event.target.closest<HTMLTableRowElement>('[data-case-row]')
    if (!row || !body.current?.contains(row)) return
    const index = Number(row.dataset.caseIndex)
    const controls = [...row.querySelectorAll<HTMLElement>(ROW_CONTROLS)].filter(control => control.tabIndex >= 0)
    if (event.key === 'Tab') {
      if (event.shiftKey && event.target === row && index > 0) { event.preventDefault(); focusRow(index - 1, true) }
      else if (!event.shiftKey && event.target === (controls.at(-1) ?? row) && index + 1 < items.length) { event.preventDefault(); focusRow(index + 1) }
    } else if (event.target === row) {
      const page = Math.max(1, Math.floor((body.current?.closest('.table-scroll')?.clientHeight ?? ESTIMATED_ROW_HEIGHT) / ESTIMATED_ROW_HEIGHT) - 1)
      const next = ({ ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: items.length - 1, PageDown: index + page, PageUp: index - page } as Record<string, number>)[event.key]
      if (next !== undefined) { event.preventDefault(); focusRow(Math.max(0, Math.min(items.length - 1, next))) }
    }
  }

  const start = measurable ? Math.min(range.start, Math.max(0, items.length - 1)) : 0
  const end = measurable ? Math.min(items.length, Math.max(start + 1, range.end)) : items.length
  const indexes = new Set(Array.from({ length: end - start }, (_, index) => start + index))
  // Scrolling must not unmount keyboard focus or a portalled notice-sheet dialog.
  for (const id of [focusedId, dialogId]) {
    if (id === null) continue
    const index = items.findIndex(item => item.caseId === id)
    if (index >= 0) indexes.add(index)
  }
  const renderedIndexes = [...indexes].sort((a, b) => a - b)
  const spacer = (from: number, to: number) => from === to ? null : (
    <tr key={`space-${from}`} className="case-table-spacer" aria-hidden="true" role="presentation">
      <td colSpan={columns} style={{ height: offsets[to] - offsets[from] }} />
    </tr>
  )
  return <tbody onKeyDownCapture={onKeyDown} ref={body} onFocusCapture={event => {
    if (event.target instanceof Element) setFocusedId(event.target.closest<HTMLElement>('[data-case-row]')?.dataset.caseRow ?? null)
  }} onBlurCapture={event => {
    if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setFocusedId(null)
  }}>
    {renderedIndexes.map((index, position) => {
      const gap = spacer(position === 0 ? 0 : renderedIndexes[position - 1] + 1, index)
      return <Fragment key={items[index].caseId}>{gap}<MountedCaseRow item={items[index]} index={index} renderRow={children} onDialogChange={dialogChanged} /></Fragment>
    })}
    {spacer(renderedIndexes.length ? renderedIndexes.at(-1)! + 1 : 0, items.length)}
  </tbody>
}
