import { describe,expect,it } from 'vitest'
import { parseSbmMessage,type GmailMessage } from '../src/tracking/sbm.js'

const senders = ['sbm@sbm.org.tr']
const part = (text: string,mimeType = 'text/plain',filename?: string) => ({ mimeType,filename,body: { data: Buffer.from(text).toString('base64url') } })
function message(body: string,subject = ''): GmailMessage {
  return { id: 'safety',internalDate: String(Date.now()),payload: { headers: [
    { name: 'From',value: 'SBM <sbm@sbm.org.tr>' },
    { name: 'Subject',value: subject },
    { name: 'Authentication-Results',value: 'mx.google.com; dmarc=pass header.from=sbm.org.tr' },
  ],...part(body) } }
}
describe('SBM message evidence boundaries',() => {
  it('never completes from a subject status without a body result',() => {
    expect(parseSbmMessage(message('Başvuru no: 001\nİnceleme devam ediyor.','Sonuç: Tamamlandı'),senders)).toMatchObject({ status: null,reason: 'ambiguous_result' })
  })
  it('never treats a text attachment as the current result',() => {
    const m = message('')
    m.payload = { headers: m.payload.headers,mimeType: 'multipart/mixed',parts: [part('Başvuru no: 001\nİnceleme devam ediyor.'),part('Başvuru no: 001\nSonuç: Tamamlandı','text/plain','old-result.txt')] }
    expect(parseSbmMessage(m,senders)).toMatchObject({ status: null,reason: 'attachment_requires_review' })
  })
  it('keeps an attachment-only reference for human review without completing',() => {
    const m = message('')
    m.payload = { headers: m.payload.headers,mimeType: 'multipart/mixed',parts: [part('Başvuru no: 001\nSonuç: Tamamlandı','text/plain','result.txt')] }
    expect(parseSbmMessage(m,senders)).toMatchObject({ applicationNumber: '001',status: null,reason: 'attachment_requires_review' })
  })
  it('does not complete from quoted email history',() => {
    const m = message('')
    m.payload = { headers: m.payload.headers,...part('<p>Başvuru no: 001</p><p>İnceleme devam ediyor.</p><blockquote><p>Sonuç: Tamamlandı</p></blockquote>','text/html') }
    expect(parseSbmMessage(m,senders).reason).toBe('quoted_result_requires_review')
  })
  it.each(['Başvuru No.: 001','Başvuru Numarası : 001','BAŞVURU NUMARASI: 001'])('extracts labeled application numbers: %s',(label) => {
    expect(parseSbmMessage(message(`${label}\nSonuç: Tamamlandı`),senders)).toMatchObject({ applicationNumber: '001',status: 'completed',reason: null })
  })
  it('does not match a claim number as an application number',() => {
    expect(parseSbmMessage(message('Hasar no: 001\nSonuç: Tamamlandı'),senders)).toMatchObject({ applicationNumber: null,reason: 'ambiguous_number' })
  })
  it('decodes HTML table boundaries and numeric entities',() => {
    const m = message('')
    m.payload = { headers: m.payload.headers,...part('<table><tr><td>Ba&#351;vuru No.</td><td>:</td><td>001</td></tr><tr><td>Sonu&#231;:</td><td>Tamamland&#305;</td></tr></table>','text/html') }
    expect(parseSbmMessage(m,senders)).toMatchObject({ applicationNumber: '001',status: 'completed',reason: null })
  })
  it.each([
    ['Başvuru no: 001\nBaşvurunuz alınmıştır.','application_notification'],
    ['Başvuru no: 001\nBaşvurunuz reddedilmiştir.','rejection_notification'],
    ['Başvuru no: 001\nBaşvurunuz iptal edilmiştir.','cancellation_requires_review'],
    ['Başvuru no: 001\nBilgilendirme amacıyla gönderilmiştir.','information_notification'],
  ])('classifies notices without inventing a terminal result',(body,reason) => {
    expect(parseSbmMessage(message(body),senders)).toMatchObject({ applicationNumber: '001',status: null,reason })
  })
  it('does not complete a rejected application containing a historical completed field',() => {
    expect(parseSbmMessage(message('Başvuru no: 001\nBaşvurunuz reddedilmiştir.\nSonuç: Tamamlandı'),senders)).toMatchObject({ status: null,reason: 'rejection_notification' })
  })
  it.each([
    ['Başvuru no: 001\nÖnceki durum: Tamamlandı','ambiguous_result'],
    ['Başvuru no: 001\nSonuç: Tamamlandı\nDurum: Reddedildi','rejection_notification'],
    ['Başvuru no: 001\nBaşvurunuz iptal edilmiştir.\nSonuç: Tamamlandı','cancellation_requires_review'],
    ['Başvuru no: 001\n> Sonuç: Tamamlandı','quoted_result_requires_review'],
  ])('does not infer a successful result from contradictory or historical fields',(body,reason) => {
    expect(parseSbmMessage(message(body),senders)).toMatchObject({ status: null,reason })
  })
})
