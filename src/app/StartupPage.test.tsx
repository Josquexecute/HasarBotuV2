import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, useLocation } from 'react-router'
import { StartupPage } from './StartupPage'

function Location() { return <span data-testid="route">{useLocation().pathname}</span> }
it('applies persisted startup choice once and still permits returning to dashboard', async () => {
  localStorage.setItem('hasarbotu-default-page', JSON.stringify('Dosyalar'))
  render(<MemoryRouter><StartupPage /><Location /><Link to="/">Pano</Link></MemoryRouter>)
  expect(screen.getByTestId('route')).toHaveTextContent('/dosyalar')
  await userEvent.click(screen.getByText('Pano'))
  expect(screen.getByTestId('route').textContent).toBe('/')
})
it('preserves direct case URLs over the startup preference', () => {
  localStorage.setItem('hasarbotu-default-page', JSON.stringify('Dosyalar'))
  render(<MemoryRouter initialEntries={['/dosyalar/case-a']}><StartupPage /><Location /></MemoryRouter>)
  expect(screen.getByTestId('route').textContent).toBe('/dosyalar/case-a')
})
