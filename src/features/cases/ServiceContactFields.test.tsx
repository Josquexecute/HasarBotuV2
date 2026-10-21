import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ServiceContactFields } from './ServiceContactFields'
import { serviceContactDraft } from './service-contact'
import { suggestEmailService } from './service-email'

describe('service identity and conservative email suggestions', () => {
  it('clears old contacts on a different service and fills the exact directory match', () => {
    const onChange = vi.fn()
    render(<ServiceContactFields value={{ name: 'Old Repair', phone: 'old phone', address: 'old address' }} options={[{ name: 'New Repair', phone: '0212 555 10 10' }]} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Servis adı'), { target: { value: 'New Repair' } })
    expect(onChange).toHaveBeenLastCalledWith({ name: 'New Repair', phone: '0212 555 10 10', address: '' })
    fireEvent.change(screen.getByLabelText('Servis adı'), { target: { value: 'Unlisted Repair' } })
    expect(onChange).toHaveBeenLastCalledWith({ name: 'Unlisted Repair', phone: '', address: '' })
  })
  it('preserves entered contacts on equivalent names and allows telephone/address edits', () => {
    const value = { name: 'Repair', phone: 'manual phone', address: 'manual address' }, onChange = vi.fn()
    render(<ServiceContactFields value={value} options={[]} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Servis adı'), { target: { value: ' REPAIR ' } })
    expect(onChange).toHaveBeenLastCalledWith({ ...value, name: ' REPAIR ' })
    fireEvent.change(screen.getByLabelText('Servis telefonu'), { target: { value: 'corrected phone' } })
    expect(onChange).toHaveBeenLastCalledWith({ ...value, phone: 'corrected phone' })
    fireEvent.change(screen.getByLabelText('Servis adresi'), { target: { value: 'corrected address' } })
    expect(onChange).toHaveBeenLastCalledWith({ ...value, address: 'corrected address' })
  })
  it('uses only matching SBM sections when choosing a revised service', () => {
    const text = 'Tamirhane Yeri Bilgileri\nTamirhane Ad / Ünvan: Old Repair\nTelefon: 0212 555 10 10\nAçık Adres: Old Street\nEkspertiz Yeri Bilgileri\nEkspertiz Yeri Ad/Ünvan: New Repair\nTelefon: 0216 555 20 20\nAçık Adres: New Street'
    expect(serviceContactDraft('New Repair', [], text, true)).toEqual({ name: 'New Repair', phone: '0216 555 20 20', address: 'New Street' })
    expect(serviceContactDraft('Unknown Repair', [], text, true)).toEqual({ name: 'Unknown Repair', phone: '', address: '' })
  })
  it('suggests explicitly labelled email contacts without using the sender phone or address', () => {
    expect(suggestEmailService('Servis Adı: E-posta Servisi\nServis Telefonu: 0212 555 10 10\nServis Adresi: Sentetik Cadde 1\nTelefon: 0532 555 99 99\nAdres: Sigortacı adresi')).toEqual({ name: 'E-posta Servisi', phone: '0212 555 10 10', address: 'Sentetik Cadde 1' })
    expect(suggestEmailService('Servis Adı: E-posta Servisi\nTelefon: 0532 555 99 99\nAdres: Gönderen adresi')).toEqual({ name: 'E-posta Servisi', phone: '', address: '' })
  })
  it('leaves ambiguous identities and ambiguous contact fields unresolved', () => {
    expect(suggestEmailService('Servis Adı: A\nServis Adı: B\nServis Telefonu: 123')).toBeNull()
    expect(suggestEmailService('Servis Adı: A\nServis Telefonu: 123\nServis Telefonu: 456\nServis Adresi: X\nServis Adresi: Y')).toEqual({ name: 'A', phone: '', address: '' })
    expect(suggestEmailService('Sigortalı: A\nTelefon: 123')).toBeNull()
  })
  it('never borrows the next line for an empty email service field', () => {
    expect(suggestEmailService('Servis Adı:\nTelefon: 0532 555 99 99')).toBeNull()
    expect(suggestEmailService('Servis Adı: A\nServis Telefonu:\nTelefon: 0532 555 99 99\nServis Adresi:\nAdres: Sender Street')).toEqual({ name: 'A', phone: '', address: '' })
  })
  it('recognizes explicit Turkish uppercase email service labels', () => {
    expect(suggestEmailService('SERVİS ADI: A\nSERVİS TELEFONU: 0212 555 10 10\nSERVİS ADRESİ: Synthetic Street')).toEqual({ name: 'A', phone: '0212 555 10 10', address: 'Synthetic Street' })
  })
})
