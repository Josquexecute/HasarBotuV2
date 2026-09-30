import { describe,expect,it } from 'vitest'
import { generateKeyPairSync,sign } from 'node:crypto'
import { applicationNumberSchema } from '@hasarbotu/contracts'
import { decryptToken,encryptToken,parseGoogleConfig,validateGoogleClaims,createGoogleProvider } from '../src/tracking/google.js'
import { parseSbmMessage, type GmailMessage } from '../src/tracking/sbm.js'
import { sbmFixture,sbmNumber } from '../test-support/sbm-fixtures.js'

const claims = { iss: 'https://accounts.google.com',sub: 'google-sub',aud: 'client',exp: 2_000_000_000,iat: 1_700_000_000,nonce: 'nonce',email: 'employee@baranekspertiz.com',email_verified: true,hd: 'baranekspertiz.com' }
const now = 1_800_000_000_000
describe('Google and SBM trust boundaries',() => {
  it('keeps leading zeros and numbers beyond JavaScript precision; rejects numeric JSON',() => {
    expect(applicationNumberSchema.parse('000123456789012345678901234567890')).toBe('000123456789012345678901234567890')
    for (const input of [123,1e20,'1e20',' 001','001 ','+12','１２３','1.0']) expect(applicationNumberSchema.safeParse(input).success).toBe(false)
  })
  it.each([
    { hd: 'other.example' },{ email: 'x@gmail.com' },{ email_verified: false },{ nonce: 'wrong' },{ aud: 'other' },{ iss: 'https://evil.example' },{ exp: 1_700_000_000 },{ iat: 1_900_000_000 },{ aud: ['client','other'] },{ azp: 'other' },
  ])('rejects invalid identity claims %j',(change) => {
    expect(() => validateGoogleClaims({ ...claims,...change },'client','nonce',true,now)).toThrow()
  })
  it('accepts verified corporate claims; mail identity does not grant corporate login',() => {
    expect(validateGoogleClaims(claims,'client','nonce',true,now).sub).toBe('google-sub')
    expect(validateGoogleClaims({ ...claims,email: 'sbm-mail@gmail.com',hd: undefined },'client','nonce',false,now).email).toBe('sbm-mail@gmail.com')
  })
  it('encrypts credentials, detects tampering and prevents cross-account credential swaps',() => {
    const key = 'ab'.repeat(32)
    const encrypted = encryptToken('a-secret-refresh-value',key,'org:subject')
    expect(encrypted).not.toContain('a-secret-refresh-value')
    expect(decryptToken(encrypted,key,'org:subject')).toBe('a-secret-refresh-value')
    expect(() => decryptToken(encrypted,key,'other:subject')).toThrow()
    expect(() => decryptToken(encrypted,'cd'.repeat(32),'org:subject')).toThrow()
    expect(() => decryptToken(encrypted.slice(0,-5)+'aaaaa',key,'org:subject')).toThrow()
  })
  it('config is disabled until complete; automatic SBM never defaults on; scopes are separate',() => {
    expect(parseGoogleConfig({})).toBeUndefined()
    expect(() => parseGoogleConfig({ GOOGLE_CLIENT_ID: 'client' })).toThrow()
    const config = parseGoogleConfig({ GOOGLE_CLIENT_ID: 'client',GOOGLE_CLIENT_SECRET: 'secret',GOOGLE_REDIRECT_URI: 'https://example.com/api/v1/google/callback',GOOGLE_TOKEN_ENCRYPTION_KEY: 'ab'.repeat(32) })!
    expect(config.automaticSbmEnabled).toBe(false)
    const provider = createGoogleProvider(config)
    const login = new URL(provider.authorizeUrl('login','state','nonce','verifier'))
    const mail = new URL(provider.authorizeUrl('mail','state','nonce','verifier'))
    expect(login.searchParams.get('scope')).not.toContain('gmail')
    expect(mail.searchParams.get('scope')).toContain('gmail.readonly')
    expect(mail.searchParams.get('access_type')).toBe('offline')
    expect(login.searchParams.get('code_challenge_method')).toBe('S256')
  })
  it('verifies the actual RSA signature and rejects a changed signed payload',async () => {
    const { privateKey,publicKey } = generateKeyPairSync('rsa',{ modulusLength: 2048 })
    const config = { clientId: 'client',clientSecret: 'secret',redirectUri: 'https://example.com/api/v1/google/callback',encryptionKey: 'ab'.repeat(32),sbmSenders: [],automaticSbmEnabled: false }
    const provider = createGoogleProvider(config,async () => Response.json({ keys: [{ ...publicKey.export({ format: 'jwk' }),kid: 'test-key',alg: 'RS256',use: 'sig' }] }))
    const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
    const header = encode({ alg: 'RS256',kid: 'test-key' })
    const payload = encode({ ...claims,iat: Date.now()/1000,exp: Date.now()/1000+60 })
    const signature = sign('RSA-SHA256',Buffer.from(`${header}.${payload}`),privateKey).toString('base64url')
    expect((await provider.identity(`${header}.${payload}.${signature}`,'nonce',true)).sub).toBe('google-sub')
    await expect(provider.identity(`${header}.${encode({ ...claims,sub: 'attacker' })}.${signature}`,'nonce',true)).rejects.toThrow('signature')
  })
})

describe('SBM real-template regressions (anonymized)',() => {
  const senders = ['sbm@sbm.org.tr']
  function changeHtml(transform: (html: string) => string) {
    const message = sbmFixture('agreement')
    const part = message.payload.parts![0] as { body: { data: string } }
    part.body.data = Buffer.from(transform(Buffer.from(part.body.data,'base64url').toString('utf8'))).toString('base64url')
    return message
  }
  it('reads the real nested HTML agreement and retains the actual outcome, not just completed',() => {
    expect(parseSbmMessage(sbmFixture('agreement'),senders)).toMatchObject({ applicationNumber: sbmNumber,status: 'completed',reason: null,
      text: 'Sonuç: MUTABAKAT - ŞİRKETLER ARASI MUTABAKAT (SON DURUM)' })
  })
  it('extracts the KTT number from the entry notice, ignoring insurer code 906 without completing it',() => {
    expect(parseSbmMessage(sbmFixture('entry'),senders)).toMatchObject({ applicationNumber: sbmNumber,status: null,reason: 'non_result_notification' })
  })
  it('rejects different numbers in subject and body',() => {
    expect(parseSbmMessage(changeHtml((html) => html.replace(sbmNumber,'000987654321')),senders)).toMatchObject({ applicationNumber: null,reason: 'ambiguous_number' })
  })
  it('does not complete from the subject alone',() => {
    expect(parseSbmMessage(changeHtml(() => '<p>Detaylar sistemdedir.</p>'),senders)).toMatchObject({ applicationNumber: sbmNumber,status: null,reason: 'ambiguous_result' })
  })
  it.each(['KOMİSYON KARARI','İPTAL','MUTABAKAT SAĞLANAMADI'])('requires review of an unverified outcome: %s',(outcome) => {
    const m = changeHtml((html) => html.replace('MUTABAKAT - ŞİRKETLER ARASI MUTABAKAT (SON DURUM)',outcome))
    expect(parseSbmMessage(m,senders)).toMatchObject({ status: null,reason: 'unsupported_result' })
  })
  it('queues contradictory results even when the known agreement is also present',() => {
    expect(parseSbmMessage(changeHtml((html) => `${html}<p>Durum: İptal edildi</p>`),senders).reason).toBe('ambiguous_result')
    expect(parseSbmMessage(changeHtml((html) => `${html}<p>${sbmNumber} nolu KTT İPTAL şeklinde sonuçlanmıştır.</p>`),senders).reason).toBe('unsupported_result')
  })
  it('rejects an untrusted copy of the exact real template',() => {
    const m = sbmFixture('agreement')
    m.payload.headers[2]!.value = 'mx.google.com; dmarc=fail header.from=sbm.org.tr'
    expect(parseSbmMessage(m,senders).reason).toBe('untrusted_sender')
    expect(parseSbmMessage(sbmFixture('agreement'),[]).reason).toBe('untrusted_sender')
  })
  it('keeps canonical result text across insignificant HTML spacing changes',() => {
    const original = parseSbmMessage(sbmFixture('agreement'),senders)
    const changed = parseSbmMessage(changeHtml((html) => html.replace('MUTABAKAT -','MUTABAKAT   -')),senders)
    expect(changed.reason).toBeNull();expect(changed.text).toBe(original.text)
    expect(changed.evidenceHash).not.toBe(original.evidenceHash)
  })
  it('does not extract a valid suffix from an oversized number',() => {
    const m = changeHtml((html) => html.replaceAll(sbmNumber,'1'.repeat(129)))
    m.payload.headers[1]!.value = m.payload.headers[1]!.value.replaceAll(sbmNumber,'1'.repeat(129))
    expect(parseSbmMessage(m,senders)).toMatchObject({ applicationNumber: null,reason: 'ambiguous_number' })
  })
})

function email(body: string, from = 'results@sbm.example'): GmailMessage {
  return { id: 'm1',internalDate: '1800000000000',payload: { mimeType: 'text/plain',headers: [{ name: 'From',value: from },{ name: 'Authentication-Results',value: 'mx.google.com; dmarc=pass header.from=sbm.example' }],body: { data: Buffer.from(body).toString('base64url') } } }
}
describe('SBM synthetic parser fixtures — not real-message certification',() => {
  it('reads a nested HTML-only MIME result without losing leading zeros',() => {
    const message = email('')
    message.payload = { headers: message.payload.headers,mimeType: 'multipart/alternative',parts: [{ mimeType: 'text/html',body: { data: Buffer.from('<p>Başvuru no: 000007</p><p>Sonuç: İptal edildi</p>').toString('base64url') } }] }
    expect(parseSbmMessage(message,['results@sbm.example'])).toMatchObject({ applicationNumber: '000007',status: 'cancelled',reason: null })
  })
  it('extracts only a labeled exact text number and explicit result',() => {
    const r = parseSbmMessage(email('Başvuru numarası: 00012345678901234567890\nSonuç: Tamamlandı'),['results@sbm.example'])
    expect(r).toMatchObject({ applicationNumber: '00012345678901234567890',status: 'completed',reason: null })
  })
  it.each([
    ['Başvuru no: 001\nBaşvuru no: 002\nSonuç: Tamamlandı','ambiguous_number'],
    ['Başvuru no: 001\nSonuç: Tamamlandı\nDurum: İptal edildi','ambiguous_result'],
    ['Telefon: 0001234567890\nSonuç: Tamamlandı','ambiguous_number'],
    ['Başvuru no: 001\nSonuç: İptal edilmedi','ambiguous_result'],
    ['Başvuru no: 001\nİşlem sonucunu görüntülemek için tıklayın','ambiguous_result'],
  ])('queues ambiguous message: %s',(body,reason) => expect(parseSbmMessage(email(body),['results@sbm.example']).reason).toBe(reason))
  it('rejects spoofed sender and failed authentication',() => {
    expect(parseSbmMessage(email('Başvuru no: 001\nSonuç: Tamamlandı','attacker@else.example'),['results@sbm.example']).reason).toBe('untrusted_sender')
    const m = email('Başvuru no: 001\nSonuç: Tamamlandı')
    m.payload.headers[1]!.value = 'mx.google.com; dmarc=fail header.from=sbm.example'
    expect(parseSbmMessage(m,['results@sbm.example']).reason).toBe('untrusted_sender')
  })
})
