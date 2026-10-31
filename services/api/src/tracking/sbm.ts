import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { SbmResult } from './store.js'

interface MimePart { mimeType?: string; filename?: string; headers?: { name: string;value: string }[]; body?: { data?: string;attachmentId?: string }; parts?: MimePart[] }
export const gmailMessageSchema = z.object({ id: z.string(), internalDate: z.string().regex(/^\d+$/), payload: z.object({ headers: z.array(z.object({ name: z.string(),value: z.string() })), mimeType: z.string().optional(), filename: z.string().optional(), body: z.object({ data: z.string().optional(),attachmentId: z.string().optional() }).optional(), parts: z.array(z.unknown()).optional() }) })
export type GmailMessage = z.infer<typeof gmailMessageSchema>

function htmlText(html: string): string {
  return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'')
    .replace(/<(?:br\b[^>]*|\/p|\/div|\/tr|\/li)>/gi,'\n').replace(/<[^>]*>/g,' ')
    .replace(/&(?:#(x[0-9a-f]+|[0-9]+)|nbsp|amp|quot|apos|lt|gt);/gi,(entity: string,numeric: string | undefined) => {
      if (numeric) {
        const code = numeric.toLowerCase().startsWith('x') ? parseInt(numeric.slice(1),16) : Number(numeric)
        return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : ' '
      }
      return ({ '&nbsp;': ' ','&amp;': '&','&quot;': '"','&apos;': "'",'&lt;': '<','&gt;': '>' } as Record<string,string>)[entity.toLowerCase()] ?? entity
    })
}

function messageContent(payload: MimePart) {
  const body: string[] = [],attachments: string[] = []
  let incomplete = false,quoted = false,hasAttachments = false
  function visit(value: unknown,depth: number,inAttachment = false) {
    if (!value || typeof value !== 'object' || depth > 12) { incomplete = true;return }
    const part = value as MimePart
    const attachment = inAttachment || part.mimeType === 'message/rfc822' || !!part.filename || !!part.headers?.some(h => h.name.toLowerCase() === 'content-disposition' && /^attachment\b/i.test(h.value))
    if (attachment && !part.mimeType?.startsWith('image/')) hasAttachments = true
    if (part.mimeType === 'text/plain' || part.mimeType === 'text/html') {
      if (part.body?.attachmentId && !part.body.data) incomplete = true
      if (part.body?.data) {
        const raw = Buffer.from(part.body.data,'base64url').toString('utf8')
        if (raw.length > 100_000) incomplete = true
        if (!attachment && /<blockquote\b|class=["'][^"']*gmail_quote|^\s*>|^-{2,}\s*(?:original message|forwarded message|orijinal ileti)/im.test(raw)) quoted = true
        const target = attachment ? attachments : body
        target.push(part.mimeType === 'text/html' ? htmlText(raw) : raw)
      }
    }
    if (part.parts) {
      if (!Array.isArray(part.parts)) incomplete = true
      else for (const child of part.parts) visit(child,depth+1,attachment)
    }
  }
  visit(payload,0)
  const text = body.join('\n')
  if (text.length > 100_000) incomplete = true
  return { body: text.slice(0,100_000),attachments: attachments.join('\n').slice(0,100_000),incomplete,quoted,hasAttachments }
}

const kttReference = String.raw`(?<![0-9])([0-9]{1,128})\s+no['’]?lu\s+(?:kaza\s+tespit\s+tutanaği(?:\s*\(ktt\))?|ktt)(?=\s|[.!?]|$)`
const agreementResult = 'MUTABAKAT - ŞİRKETLER ARASI MUTABAKAT (SON DURUM)'
const commissionResult = 'KOMİSYON OYBİRLİĞİ ONAYI (SON DURUM)'
const fold = (text: string) => text.toLocaleLowerCase('tr-TR').replaceAll('ı','i')

/** Exact outcomes verified against real, authenticated KTT templates; others need review. */
export function parseSbmMessage(message: GmailMessage, allowedSenders: readonly string[]): SbmResult {
  const header = (name: string) => message.payload.headers.find((h) => h.name.toLowerCase() === name)?.value ?? ''
  const from = header('from').trim().toLowerCase()
  const sender = from.match(/^[^<>]*<([^<>\s]+)>$/)?.[1] ?? from
  const authentication = header('authentication-results').toLowerCase()
  const domain = sender.split('@')[1] ?? ''
  const trusted = allowedSenders.includes(sender) && /^mx\.google\.com\s*;/.test(authentication)
    && authentication.split(';').some((entry) => /\bdmarc=pass\b/.test(entry) && entry.match(/\bheader\.from=([^\s;]+)/)?.[1] === domain)
  const content = messageContent(message.payload as MimePart)
  const body = content.body.normalize('NFC').replace(/\r/g,'')
  const text = `${header('subject')}\n${body}\n${content.attachments}`.normalize('NFC').replace(/\r/g,'')
  const folded = fold(text)
  const numbers = [...folded.matchAll(/(?:başvuru|basvuru)[ \t]*(?:numarasi|no)\.?[ \t]*[:：][ \t]*([0-9]{1,128})[ \t]*(?=$|\n)/gmu)].map((m) => m[1]!)
  numbers.push(...[...folded.matchAll(new RegExp(kttReference,'gu'))].map((m) => m[1]!))
  // The entry notice has another number (the insurer code); only its KTT reference identifies the case.
  const entryNotice = /\bktt\s+girişi\s+yapilmiştir\b/u.test(folded)
  const kttOutcomes = [...fold(body.normalize('NFC')).matchAll(new RegExp(`${kttReference}[ \\t]+([^\\r\\n]+?)[ \\t]+şeklinde[ \\t]+sonuçlanmiştir\\.[ \\t]*(?=$|\\r?\\n)`,'gmu'))]
    .map((m) => m[2]!.replace(/\s+/g,' ').trim())
  const verifiedOutcomes = [agreementResult,commissionResult].filter(outcome => kttOutcomes.includes(fold(outcome)))
  const unknownOutcome = kttOutcomes.some(outcome => ![fold(agreementResult),fold(commissionResult)].includes(outcome))
  const unique = [...new Set(numbers)]
  const foldedBody = fold(body)
  const resultFields = [...foldedBody.matchAll(/^[ \t]*(?:sonuç|sonuc|durum)[ \t]*[:：][ \t]*([^\n]+?)[ \t]*(?=$|\n)/gmu)].map(m => m[1]!.trim())
  const unsupportedField = resultFields.some(value => !['tamamlandi','iptal edildi'].includes(value))
  const statuses = resultFields.filter(value => ['tamamlandi','iptal edildi'].includes(value)).map(value => value === 'iptal edildi' ? 'cancelled' as const : 'completed' as const)
  if (verifiedOutcomes.length) statuses.push('completed')
  const uniqueStatuses = [...new Set(statuses)]
  const reason = !trusted ? 'untrusted_sender' : unique.length !== 1 ? 'ambiguous_number'
    : content.incomplete ? 'incomplete_message' : content.hasAttachments ? 'attachment_requires_review' : content.quoted ? 'quoted_result_requires_review'
    : entryNotice ? (uniqueStatuses.length ? 'ambiguous_result' : 'non_result_notification')
      : /\b(?:reddedilmiştir|reddedildi|başvuru reddi)\b/u.test(foldedBody) ? 'rejection_notification'
        : /başvurunuz[ \t]+iptal (?:edilmiştir|edildi)/u.test(foldedBody) ? 'cancellation_requires_review'
          : unknownOutcome || unsupportedField && statuses.length > 0 ? 'unsupported_result' : uniqueStatuses.length > 1 || verifiedOutcomes.length > 1 ? 'ambiguous_result'
          : uniqueStatuses.length === 1 ? null
            : /\biptal (?:edilmiştir|edildi)\b/u.test(foldedBody) ? 'cancellation_requires_review'
              : /başvurunuz (?:alinmiştir|alindi)|başvuru kaydi oluşturul/u.test(foldedBody) ? 'application_notification'
                : /bilgilendirme amaciyla|bilgi amaciyla/u.test(foldedBody) ? 'information_notification' : 'ambiguous_result'
  return { applicationNumber: unique.length === 1 ? unique[0]! : null, status: reason === null && uniqueStatuses.length === 1 ? uniqueStatuses[0]! : null,
    text: reason === null ? `Sonuç: ${verifiedOutcomes[0] ?? (uniqueStatuses[0] === 'completed' ? 'Tamamlandı' : 'İptal edildi')}` : text.slice(0,4000),
    evidenceHash: createHash('sha256').update(text).digest('hex'),reason }
}
