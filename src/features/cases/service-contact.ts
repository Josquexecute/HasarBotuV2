import { eksistKey, resolveServiceContact } from '@hasarbotu/domain'

export interface ServiceContactDraft { name: string; phone: string; address: string }
export function serviceContactDraft(name: string, options: readonly { name: string; phone?: string | null; address?: string | null }[], text?: string, revised = false): ServiceContactDraft {
  const matches = options.filter(option => eksistKey(option.name) === eksistKey(name))
  const fields = resolveServiceContact({ serviceName: name, servicePhone: matches.length === 1 ? matches[0]!.phone ?? null : null, serviceAddress: matches.length === 1 ? matches[0]!.address ?? null : null, eksistText: text ?? null, eksistServiceRevised: revised })
  return { name, phone: fields.servicePhone, address: fields.serviceAddress }
}

