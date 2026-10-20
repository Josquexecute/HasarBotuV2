import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const FOCUSABLE = 'button:not(:disabled), a[href], summary, input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

export function ModalFrame({ children, labelledBy, onClose, className = '', busy = false, inert = false, nested = false, role = 'dialog' }: {
  children: ReactNode
  labelledBy: string
  onClose(): void
  className?: string
  busy?: boolean
  inert?: boolean
  nested?: boolean
  role?: 'dialog' | 'alertdialog'
}) {
  const dialog = useRef<HTMLElement>(null)
  const previousFocus = useRef(document.activeElement as HTMLElement | null)
  useEffect(() => {
    const previous = previousFocus.current
    const element = dialog.current
    if (element && !element.contains(document.activeElement)) element.focus({ preventScroll: true })
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }) }
  }, [])

  return createPortal(<div className={`modal-backdrop${nested ? ' modal-backdrop--nested' : ''}`} role="presentation" onMouseDown={event => {
    if (event.currentTarget === event.target && !busy && !inert) onClose()
  }}>
    <section ref={dialog} className={`modal ${className}`.trim()} role={role} aria-modal="true" aria-labelledby={labelledBy} aria-busy={busy} inert={inert} tabIndex={-1} onKeyDown={event => {
      if (event.defaultPrevented || inert) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (!busy) onClose()
      }
      if (event.key === 'Tab') {
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('*')].filter(control =>
          control.matches(FOCUSABLE) && (control.tabIndex >= 0 || control.matches('summary:not([tabindex])')) && !control.closest('[inert], [hidden]') &&
          (!control.closest('details:not([open])') || control.matches('details:not([open]) > summary')) &&
          getComputedStyle(control).display !== 'none' && getComputedStyle(control).visibility !== 'hidden')
        const first = controls[0], last = controls.at(-1)
        if (!first || !last) { event.preventDefault(); event.currentTarget.focus(); return }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    }}>{children}</section>
  </div>, document.querySelector('.theme-root') ?? document.body)
}
