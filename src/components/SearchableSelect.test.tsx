import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { SearchableSelect } from './SearchableSelect'
import { ModalFrame } from './ModalFrame'

const options = [{ value: '', label: 'Tümü' }, { value: '1', label: 'Şişli Özel Servis' }, { value: '2', label: 'Başkent Otomotiv' }]

it('searches Turkish text and changes the selected ID only after selection', async () => {
  const change = vi.fn(), user = userEvent.setup()
  render(<SearchableSelect label="Servis" value="" options={options} onChange={change} />)
  const input = screen.getByRole('combobox', { name: 'Servis' })
  await user.click(input)
  await user.type(input, 'sisli')
  expect(screen.getAllByRole('option')).toHaveLength(1)
  expect(change).not.toHaveBeenCalled()
  await user.keyboard('{Enter}')
  expect(change).toHaveBeenCalledWith('1')
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
})

it('supports arrows, Escape and Tab without committing search text', async () => {
  const change = vi.fn(), user = userEvent.setup()
  render(<><SearchableSelect label="Servis" value="1" options={options} onChange={change} /><button>Sonraki</button></>)
  await user.tab()
  await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
  expect(change).toHaveBeenCalledWith('2')
  change.mockClear()
  await user.click(screen.getByRole('combobox'))
  await user.type(screen.getByRole('combobox'), 'yok')
  expect(screen.getByRole('status')).toHaveTextContent('Eşleşen seçenek bulunamadı')
  await user.keyboard('{Escape}')
  expect(screen.getByRole('combobox')).toHaveValue('Şişli Özel Servis')
  await user.click(screen.getByRole('combobox'))
  await user.tab()
  expect(screen.getByRole('button')).toHaveFocus()
  expect(change).not.toHaveBeenCalled()
})

it('selects with the mouse while keeping input focus', async () => {
  const user = userEvent.setup()
  function Example() {
    const [value, setValue] = useState('')
    return <SearchableSelect label="Servis" value={value} options={options} onChange={setValue} />
  }
  render(<Example />)
  await user.click(screen.getByRole('combobox'))
  await user.click(screen.getByRole('option', { name: 'Başkent Otomotiv' }))
  expect(screen.getByRole('combobox')).toHaveValue('Başkent Otomotiv')
  expect(screen.getByRole('combobox')).toHaveFocus()
})

it('closes its popup when disabled and consumes Escape before a parent modal', async () => {
  const close = vi.fn(), user = userEvent.setup()
  const view = render(<ModalFrame labelledBy="title" onClose={close}><h2 id="title">Filtre</h2><SearchableSelect label="Servis" value="" options={options} onChange={vi.fn()} /></ModalFrame>)
  await user.click(screen.getByRole('combobox'))
  await user.keyboard('{Escape}')
  expect(close).not.toHaveBeenCalled()
  await user.click(screen.getByRole('combobox'))
  view.rerender(<SearchableSelect disabled label="Servis" value="" options={options} onChange={vi.fn()} />)
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('combobox'))
  expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false')
})
