import type { GmailMessage } from '../src/tracking/sbm.js'

// Anonymized from the two user-supplied EMLs (2026-09-30). No recipients or transport identifiers retained.
export const sbmNumber = '000123456789012345678901'
const templates = {
  "entry": {
    "subject": "000123456789012345678901 - 906 - TOBB KTT  ihbarı!",
    "html": "<p><span style=\"color: rgb(51, 51, 51); font-family: sans-serif, Arial, Verdana, &quot;Trebuchet MS&quot;; font-size: 13px;\">906 - TOBB tarafından şirketinizi de ilgilendiren 000123456789012345678901 nolu KTT girişi yapılmıştır. Değerlendirme sürecinin en kısa sürede tamamlanması gerekmektedir.Üç iş günü içerisinde mutabakat sağlandığı takdirde dosya kapatılır. Aksi durumda komisyona gönderilir.</span><br style=\"color: rgb(51, 51, 51); font-family: sans-serif, Arial, Verdana, &quot;Trebuchet MS&quot;; font-size: 13px;\"><br style=\"color: rgb(51, 51, 51); font-family: sans-serif, Arial, Verdana, &quot;Trebuchet MS&quot;; font-size: 13px;\"><span style=\"color: rgb(51, 51, 51); font-family: sans-serif, Arial, Verdana, &quot;Trebuchet MS&quot;; font-size: 13px;\">Bu e-posta bilgilendirme amacı ile gönderilmektedir.</span><br style=\"color: rgb(51, 51, 51); font-family: sans-serif, Arial, Verdana, &quot;Trebuchet MS&quot;; font-size: 13px;\"><br style=\"color: rgb(51, 51, 51); font-family: sans-serif, Arial, Verdana, &quot;Trebuchet MS&quot;; font-size: 13px;\"><strong style=\"color: rgb(51, 51, 51); font-family: sans-serif, Arial, Verdana, &quot;Trebuchet MS&quot;; font-size: 13px;\">Sigorta Bilgi ve Gözetim Merkezi</strong></p>"
  },
  "agreement": {
    "subject": "000123456789012345678901 nolu Kaza Tespit Tutanağı Sonuçlandı!",
    "html": "<p>Sayın İlgili,</p><p>000123456789012345678901 no'lu Kaza Tespit Tutanağı(KTT) MUTABAKAT - ŞİRKETLER ARASI MUTABAKAT (SON DURUM) şeklinde sonuçlanmıştır.</p><p>Online sistem üzerinden detaylı bilgi için tıklayınız.</p><p>Bilgilendirme amacıyla gönderilmektedir.</p><p>Sigorta Bilgi ve Gözetim Merkezi</p>"
  }
} as const

export function sbmFixture(kind: keyof typeof templates): GmailMessage {
  const template = templates[kind]
  return { id: kind,internalDate: '1790774585000',payload: {
    headers: [
      { name: 'From',value: 'sbm@sbm.org.tr' },
      { name: 'Subject',value: template.subject },
      { name: 'Authentication-Results',value: 'mx.google.com; dmarc=pass (p=NONE sp=NONE dis=NONE) header.from=sbm.org.tr' },
    ],
    mimeType: 'multipart/mixed',parts: [{ mimeType: 'text/html',body: { data: Buffer.from(template.html).toString('base64url') } }],
  } }
}
