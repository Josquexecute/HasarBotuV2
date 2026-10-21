import type { ServiceContactDraft } from './service-contact'
import { eksistKey } from '@hasarbotu/domain'

/** Explicit service labels only; sender/insured/expert contacts have no service ownership. */
export function suggestEmailService(text: string): ServiceContactDraft | null {
  const fields = text.split(/\r?\n/u).flatMap(line => {
    const match = /^([^:：]+)[:：](.*)$/u.exec(line)
    return match ? [{ label: eksistKey(match[1]!), value: match[2]!.trim() }] : []
  })
  const values = (labels: string[]) => {
    const keys = new Set(labels.map(eksistKey))
    return [...new Set(fields.filter(field => keys.has(field.label)).map(field => field.value).filter(Boolean))]
  }
  const names = values(['Servis Adı', 'Servis Adı / Ünvanı', 'Tamirhane Adı', 'Onarım Servisi'])
  if (names.length !== 1 || names[0]!.length > 500) return null
  const phones = values(['Servis Telefonu', 'Servis Tel', 'Tamirhane Telefonu'])
  const addresses = values(['Servis Adresi', 'Tamirhane Adresi'])
  return { name: names[0]!, phone: phones.length === 1 && phones[0]!.length <= 80 ? phones[0]! : '', address: addresses.length === 1 && addresses[0]!.length <= 500 ? addresses[0]! : '' }
}
