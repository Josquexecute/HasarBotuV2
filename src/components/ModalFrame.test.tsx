import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ModalFrame } from './ModalFrame'
import { ServiceRevisionDialog } from '../features/cases/ServiceRevisionDialog'

describe('shared modal interaction', () => {
  it('cycles keyboard focus within the dialog and skips disabled and hidden controls', async () => {
    const user = userEvent.setup()
    render(<ModalFrame labelledBy="title" onClose={vi.fn()}><h2 id="title">Düzenle</h2><input autoFocus aria-label="Ad" /><button disabled>Bekliyor</button><button>Kaydet</button><button hidden>Gizli</button></ModalFrame>)
    expect(screen.getByRole('textbox')).toHaveFocus()
    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Kaydet' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('textbox')).toHaveFocus()
  })

  it('restores the opener after an autofocus input is unmounted', async () => {
    function Example() {
      const [open, setOpen] = useState(false)
      return <><button onClick={() => setOpen(true)}>Aç</button>{open && <ModalFrame labelledBy="title" onClose={() => setOpen(false)}><h2 id="title">Not</h2><textarea autoFocus aria-label="Not" /></ModalFrame>}</>
    }
    const user = userEvent.setup()
    render(<Example />)
    await user.click(screen.getByRole('button', { name: 'Aç' }))
    expect(screen.getByRole('textbox')).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Aç' })).toHaveFocus()
  })

  it('keeps controls in collapsed details out of the keyboard focus loop', async () => {
    const user = userEvent.setup()
    render(<ModalFrame labelledBy="title" onClose={vi.fn()}><h2 id="title">Kanıt</h2><button autoFocus>Kapat</button><details><summary tabIndex={0}>Kaynak bilgileri</summary><input aria-label="Kaynak kimliği" /></details></ModalFrame>)
    await user.tab()
    expect(screen.getByText('Kaynak bilgileri')).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Kapat' })).toHaveFocus()
  })

  it('keeps a busy operation open and permits backdrop dismissal after it finishes', () => {
    const close = vi.fn()
    const view = render(<ModalFrame labelledBy="title" onClose={close} busy><h2 id="title">İşlem</h2></ModalFrame>)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!)
    expect(close).not.toHaveBeenCalled()
    view.rerender(<ModalFrame labelledBy="title" onClose={close}><h2 id="title">İşlem</h2></ModalFrame>)
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!)
    expect(close).toHaveBeenCalledOnce()
  })

  it('handles Escape in a nested dialog without closing its parent', () => {
    const closeParent = vi.fn(), closeChild = vi.fn()
    render(<ModalFrame labelledBy="parent" onClose={closeParent}><h2 id="parent">Ana pencere</h2><ModalFrame labelledBy="child" onClose={closeChild} nested><h2 id="child">Alt pencere</h2><input autoFocus aria-label="Alt alan" /></ModalFrame></ModalFrame>)
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    expect(closeChild).toHaveBeenCalledOnce()
    expect(closeParent).not.toHaveBeenCalled()
  })

  it('keeps the service revision portal inside the application theme', () => {
    const themeRoot = document.createElement('div')
    themeRoot.className = 'theme-root'
    themeRoot.dataset.theme = 'dark'
    document.body.append(themeRoot)
    const view = render(<ServiceRevisionDialog name="Örnek Servis" options={[]} onClose={vi.fn()} onSave={vi.fn()} />)
    expect(screen.getByRole('dialog').closest('.theme-root')).toBe(themeRoot)
    expect(screen.getByRole('combobox', { name: 'Servis adı' })).toHaveFocus()
    view.unmount()
    themeRoot.remove()
  })
})
