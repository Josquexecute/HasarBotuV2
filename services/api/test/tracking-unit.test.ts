import { describe,expect,it } from 'vitest'
import { generateKeyPairSync,sign } from 'node:crypto'
import { applicationNumberSchema } from '@hasarbotu/contracts'
import { decryptToken,encryptToken,parseGoogleConfig,validateGoogleClaims,createGoogleProvider } from '../src/tracking/google.js'
import { parseSbmMessage, type GmailMessage } from '../src/tracking/sbm.js'

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
