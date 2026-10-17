import { useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Search } from 'lucide-react'
import { matchesSearchQuery } from '../utils/search'

export interface SelectOption {
  readonly value: string
  readonly label: string
}

/** Keep the selected ID separate from search text; typing never changes a filter. */
export function SearchableSelect({ label, value, options, onChange, disabled = false }: {
  label: string
  value: string
  options: readonly SelectOption[]
  onChange(value: string): void
  disabled?: boolean
}) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const [position, setPosition] = useState<CSSProperties>({})
  const expanded = open && !disabled
  const selected = options.find(option => option.value === value)
  const filtered = useMemo(() => options.filter(option => matchesSearchQuery(query, [option.label])), [options, query])
  const active = filtered.find(option => option.value === highlighted) ?? filtered.find(option => option.value === value) ?? filtered[0]
  const activeIndex = filtered.findIndex(option => option === active)

  function close() { setOpen(false); setQuery(''); setHighlighted(null) }
  function choose(option: SelectOption) { onChange(option.value); close() }

  useLayoutEffect(() => {
    if (!expanded) return
    const update = () => {
      const rect = input.current!.getBoundingClientRect()
      const below = window.innerHeight - rect.bottom - 12
      const above = rect.top - 12
      const upwards = below < 180 && above > below
      const width = Math.min(Math.max(rect.width, 280), window.innerWidth - 24)
      setPosition({ position: 'fixed', width, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        maxHeight: Math.min(320, Math.max(80, upwards ? above : below)),
        ...(upwards ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }) })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true) }
  }, [expanded])

  useLayoutEffect(() => {
    if (expanded) list.current?.querySelector('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [expanded, active?.value])

  return <div className="searchable-select">
    <label className="select-field" htmlFor={id}>
      <input ref={input} id={id} role="combobox" aria-label={label} aria-expanded={expanded} aria-controls={expanded ? `${id}-options` : undefined}
        aria-autocomplete="list" aria-activedescendant={expanded && active ? `${id}-option-${activeIndex}` : undefined}
        autoComplete="off" disabled={disabled} value={expanded ? query : selected?.label ?? ''}
        placeholder={expanded ? 'Yazarak ara…' : 'Seçin'} title={selected?.label}
        onClick={() => { if (!expanded) { setQuery(''); setOpen(true) } }}
        onChange={event => { setQuery(event.target.value); setHighlighted(null); setOpen(true) }}
        onBlur={close}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Escape' && expanded) { event.preventDefault(); event.stopPropagation(); close(); return }
          if (event.key === 'Tab') { close(); return }
          if (event.key === 'Enter' && expanded) { event.preventDefault(); if (active) choose(active); return }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            if (!expanded) { setQuery(''); setOpen(true); return }
            const next = Math.max(0, Math.min(filtered.length - 1, activeIndex + (event.key === 'ArrowDown' ? 1 : -1)))
            setHighlighted(filtered[next]?.value ?? null)
          }
        }} />
      <ChevronDown size={14} aria-hidden="true" />
    </label>
    {expanded && createPortal(<div className="searchable-select__popup" style={position} onMouseDown={event => event.preventDefault()}>
      <div className="searchable-select__hint"><Search size={14} aria-hidden="true" /><span>{filtered.length} seçenek · ↑ ↓ ile gezin, Enter ile seçin</span></div>
      <div ref={list} id={`${id}-options`} role="listbox" aria-label={label}>
        {filtered.map((option, index) => <div key={option.value} id={`${id}-option-${index}`} role="option" aria-selected={option.value === value}
          data-active={option === active} onMouseDown={event => event.preventDefault()} onClick={() => choose(option)}
          onPointerMove={() => setHighlighted(option.value)}>
          <span>{option.label}</span>{option.value === value && <Check size={15} aria-hidden="true" />}
        </div>)}
      </div>
      {filtered.length === 0 && <p className="searchable-select__empty" role="status">Eşleşen seçenek bulunamadı.</p>}
    </div>, document.querySelector('.theme-root') ?? document.body)}
  </div>
}
