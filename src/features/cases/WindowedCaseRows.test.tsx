import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModalFrame } from '../../components/ModalFrame'
import type { CaseRecord } from '../../types/case'
import { WindowedCaseRows } from './WindowedCaseRows'

const items = Array.from({ length: 1000 }, (_, index) => ({ caseId: `case-${index}`, plate: `34 TEST ${index}` } as CaseRecord))
let viewportHeight = 480
const rowHeights = new Map<number, number>()
const observers: { callback: ResizeObserverCallback; elements: Set<Element> }[] = []

function notifyResize() {
  act(() => {
    for (const observer of [...observers]) observer.callback([...observer.elements].map(target => ({
      target,
      borderBoxSize: [{ blockSize: target instanceof HTMLElement && target.dataset.caseIndex ? rowHeights.get(Number(target.dataset.caseIndex)) ?? 48 : 0 }],
    })) as unknown as ResizeObserverEntry[], {} as ResizeObserver)
  })
}

function renderTable(data = items, onHeightsChange?: (heights: ReadonlyMap<string, number>) => void) {
  return render(<><div className="table-scroll" aria-label="Scroller"><table><thead><tr><th>Plaka</th></tr></thead>
    <WindowedCaseRows items={data} columns={1} onHeightsChange={onHeightsChange}>{(item, index, { onDialogChange, ...attributes }) =>
      <TestRow key={item.caseId} item={item} index={index} attributes={attributes} onDialogChange={onDialogChange} />
    }</WindowedCaseRows>
  </table></div><button>After table</button></>)
}

function TestRow({ item, index, attributes, onDialogChange }: {
  item: CaseRecord
  index: number
  attributes: object
  onDialogChange: (open: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  return <tr {...attributes} tabIndex={0}><td>{item.plate}<button onClick={() => { setOpen(true); onDialogChange(true) }}>Notice {index}</button>
    {open && <ModalFrame labelledBy="notice-heading" onClose={() => { setOpen(false); onDialogChange(false) }}><h2 id="notice-heading">Notice dialog</h2><button onClick={() => { setOpen(false); onDialogChange(false) }}>Close notice</button></ModalFrame>}
  </td></tr>
}

const rows = () => [...document.querySelectorAll<HTMLTableRowElement>('[data-case-row]')]
const row = (index: number) => document.querySelector<HTMLTableRowElement>(`[data-case-index="${index}"]`)!
const scrollTo = (top: number, left = 0) => fireEvent.scroll(screen.getByLabelText('Scroller'), { target: { scrollTop: top, scrollLeft: left } })

beforeEach(() => {
  viewportHeight = 480
  rowHeights.clear()
  observers.length = 0
  vi.stubGlobal('ResizeObserver', class {
    elements = new Set<Element>()
    constructor(callback: ResizeObserverCallback) { observers.push({ callback, elements: this.elements }) }
    observe = (element: Element) => { this.elements.add(element) }
    unobserve = (element: Element) => { this.elements.delete(element) }
    disconnect = () => { this.elements.clear() }
  })
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('table-scroll') ? viewportHeight : 0 })
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) { return { height: this.tagName === 'THEAD' ? 36 : 48 } as DOMRect })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('windowed native case rows', () => {
  it('bounds mounted rows and controls independently of the loaded data size', () => {
    renderTable()
    expect(row(0)).toHaveTextContent('34 TEST 0')
    expect(row(999)).toBeNull()
    expect(rows().length).toBeLessThan(40)
    expect(document.querySelector('.case-table-spacer td')).toHaveAttribute('colspan', '1')
    expect(row(0)).toHaveAttribute('aria-rowindex', '2')
    expect(document.querySelector('.case-table-spacer')).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders the actual scrolled range while keeping the complete table height', () => {
    renderTable()
    scrollTo(500 * 48, 200)
    expect(row(500)).toHaveTextContent('34 TEST 500')
    expect(row(0)).toBeNull()
    expect(rows().length).toBeLessThan(40)
    const spacers = [...document.querySelectorAll<HTMLTableCellElement>('.case-table-spacer td')]
    expect(spacers.reduce((sum, cell) => sum + parseFloat(cell.style.height), rows().length * 48)).toBe(1000 * 48)
    expect(screen.getByLabelText('Scroller').scrollLeft).toBe(200)
  })

  it('measures taller wrapped rows and retains their height after they leave the viewport', () => {
    renderTable()
    rowHeights.set(0, 96)
    notifyResize()
    scrollTo(500 * 48)
    const first = Number(rows()[0].dataset.caseIndex)
    expect(document.querySelector<HTMLTableCellElement>('.case-table-spacer td')!.style.height).toBe(`${first * 48 + 48}px`)
    expect(row(500)).not.toBeNull()
  })

  it('recalculates visible rows when the viewport grows', () => {
    renderTable()
    const count = rows().length
    viewportHeight = 960
    notifyResize()
    expect(rows().length).toBeGreaterThan(count)
    expect(rows().length).toBeLessThan(50)
  })

  it('does not rebuild or republish geometry for newly mounted rows of the normal height', () => {
    const changed = vi.fn()
    renderTable(items, changed)
    notifyResize()
    changed.mockClear()
    scrollTo(500 * 48)
    notifyResize()
    expect(changed).not.toHaveBeenCalled()
    expect(row(500)).not.toBeNull()
  })

  it('updates geometry when a newly reached row really is taller', () => {
    const changed = vi.fn()
    renderTable(items, changed)
    notifyResize()
    changed.mockClear()
    scrollTo(500 * 48)
    rowHeights.set(500, 96)
    notifyResize()
    expect(changed).toHaveBeenCalled()
    expect((changed.mock.lastCall![0] as ReadonlyMap<string, number>).get('case-500')).toBe(96)
  })

  it('does not re-estimate ordinary preceding rows when many later rows wrap', () => {
    renderTable()
    notifyResize()
    scrollTo(500 * 48)
    for (let index = 500; index < 550; index++) rowHeights.set(index, 96)
    notifyResize()
    // Those height changes are at/after the viewport; the first 500 rows are unchanged.
    expect(row(500)).not.toBeNull()
    const first = Number(rows()[0].dataset.caseIndex)
    expect(document.querySelector<HTMLTableCellElement>('.case-table-spacer td')!.style.height).toBe(`${first * 48}px`)
  })

  it('learns the typical native row height without stretching unseen rows to a wrapped outlier', () => {
    renderTable()
    for (let index = 0; index < 30; index++) rowHeights.set(index, 50)
    rowHeights.set(0, 100)
    notifyResize()
    scrollTo(500 * 50)
    const first = Number(rows()[0].dataset.caseIndex)
    expect(document.querySelector<HTMLTableCellElement>('.case-table-spacer td')!.style.height).toBe(`${first * 50 + 50}px`)
  })

  it('keeps focused controls mounted across wheel scrolling and releases them on blur', () => {
    renderTable()
    const button = screen.getByRole('button', { name: 'Notice 0' })
    act(() => button.focus())
    scrollTo(500 * 48)
    expect(button).toHaveFocus()
    expect(row(0)).not.toBeNull()
    expect(row(500)).not.toBeNull()
    expect(rows().length).toBeLessThan(40)
    act(() => screen.getByRole('button', { name: 'After table' }).focus())
    expect(row(0)).toBeNull()
  })

  it('tabs into the next logical row even when it has not been mounted', () => {
    renderTable()
    const lastIndex = Number(rows().at(-1)!.dataset.caseIndex)
    const button = screen.getByRole('button', { name: `Notice ${lastIndex}` })
    act(() => button.focus())
    fireEvent.keyDown(button, { key: 'Tab' })
    expect(row(lastIndex + 1)).toHaveFocus()
    expect(screen.getByLabelText('Scroller').scrollTop).toBeGreaterThan(0)
  })

  it('shift-tabs to the last enabled control in the previous logical row', () => {
    renderTable()
    scrollTo(500 * 48)
    const first = rows()[0]
    const previous = Number(first.dataset.caseIndex) - 1
    act(() => first.focus())
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })
    expect(screen.getByRole('button', { name: `Notice ${previous}` })).toHaveFocus()
  })

  it('supports keyboard navigation to the loaded end and back to the beginning', () => {
    renderTable()
    act(() => row(0).focus())
    fireEvent.keyDown(row(0), { key: 'End' })
    expect(row(999)).toHaveFocus()
    fireEvent.keyDown(row(999), { key: 'ArrowUp' })
    expect(row(998)).toHaveFocus()
    fireEvent.keyDown(row(998), { key: 'Home' })
    expect(row(0)).toHaveFocus()
    expect(rows().length).toBeLessThan(40)
  })

  it('keeps a portalled notice dialog and its return focus alive while scrolling', () => {
    renderTable()
    const button = screen.getByRole('button', { name: 'Notice 0' })
    act(() => button.focus())
    fireEvent.click(button)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    scrollTo(500 * 48)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close notice' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(button).toHaveFocus()
  })

  it('continues to expose all rows when layout observation is unavailable', () => {
    vi.stubGlobal('ResizeObserver', undefined)
    renderTable(items.slice(0, 100))
    expect(rows()).toHaveLength(100)
  })

  it('disconnects all observed rows on unmount', () => {
    const view = renderTable()
    expect(observers.some(observer => observer.elements.size > 0)).toBe(true)
    view.unmount()
    expect(observers.every(observer => observer.elements.size === 0)).toBe(true)
  })
})
