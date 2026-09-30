import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { SbmResult } from './store.js'

interface MimePart { mimeType?: string; body?: { data?: string }; parts?: MimePart[] }
export const gmailMessageSchema = z.object({ id: z.string(), internalDate: z.string().regex(/^\d+$/), payload: z.object({ headers: z.array(z.object({ name: z.string(),value: z.string() })), mimeType: z.string().optional(), body: z.object({ data: z.string().optional() }).optional(), parts: z.array(z.unknown()).optional() }) })
export type GmailMessage = z.infer<typeof gmailMessageSchema>

function textParts(part: MimePart, depth = 0): string[] {
  if (depth > 12) return []
  if (part.mimeType === 'text/plain' && part.body?.data) return [Buffer.from(part.body.data,'base64url').toString('utf8')]
  const children = (part.parts ?? []).flatMap((child) => textParts(child,depth+1))
  if (children.length) return children
  if (part.mimeType === 'text/html' && part.body?.data) return [Buffer.from(part.body.data,'base64url').toString('utf8').replace(/<(?:br\b[^>]*|\/p|\/div|\/tr)>/gi,'\n').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&')]
  return []
}

/** Strict, versioned candidate grammar. Real SBM fixtures are required before automatic opt-in. */
export function parseSbmMessage(message: GmailMessage, allowedSenders: readonly string[]): SbmResult {
  const header = (name: string) => message.payload.headers.find((h) => h.name.toLowerCase() === name)?.value ?? ''
  const from = header('from').trim().toLowerCase()
  const sender = from.match(/^[^<>]*<([^<>\s]+)>$/)?.[1] ?? from
  const authentication = header('authentication-results').toLowerCase()
  const domain = sender.split('@')[1] ?? ''
  const trusted = allowedSenders.includes(sender) && /^mx\.google\.com\s*;/.test(authentication)
    && authentication.split(';').some((entry) => /\bdmarc=pass\b/.test(entry) && entry.match(/\bheader\.from=([^\s;]+)/)?.[1] === domain)
  const body = textParts(message.payload as MimePart).join('\n').slice(0,100_000)
  const text = `${header('subject')}\n${body}`.normalize('NFC').replace(/\r/g,'')
  const folded = text.toLocaleLowerCase('tr-TR').replaceAll('ı','i')
  const numbers = [...folded.matchAll(/(?:başvuru|basvuru)[ \t]*(?:numarasi|no)[ \t]*[:：][ \t]*([0-9]{1,128})[ \t]*(?=$|\n)/gmu)].map((m) => m[1]!)
  const unique = [...new Set(numbers)]
  const statuses = [...folded.matchAll(/(?:sonuç|sonuc|durum)[ \t]*[:：][ \t]*(tamamlandi|iptal edildi)[ \t]*(?=$|\n)/gmu)].map((m) => m[1] === 'iptal edildi' ? 'cancelled' as const : 'completed' as const)
  const uniqueStatuses = [...new Set(statuses)]
  const reason = !trusted ? 'untrusted_sender' : unique.length !== 1 ? 'ambiguous_number' : uniqueStatuses.length !== 1 ? 'ambiguous_result' : null
  return { applicationNumber: unique.length === 1 ? unique[0]! : null, status: uniqueStatuses.length === 1 ? uniqueStatuses[0]! : null,
    text: reason === null ? `Sonuç: ${uniqueStatuses[0] === 'completed' ? 'Tamamlandı' : 'İptal edildi'}` : text.slice(0,4000),
    evidenceHash: createHash('sha256').update(text).digest('hex'),reason }
}
