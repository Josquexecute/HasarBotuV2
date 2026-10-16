import { generateKeyPairSync, randomBytes, sign } from 'node:crypto'

// Minimal X.509 encoding for disposable test certificates, using Node builtins.
// Every invocation owns a new key; no private key or expiring certificate fixture is required.
function der(tag, ...parts) {
  const content = Buffer.concat(parts)
  let length = Buffer.from([content.length])
  if (content.length >= 128) {
    const bytes = []
    for (let remaining = content.length; remaining > 0; remaining >>>= 8) bytes.unshift(remaining & 255)
    length = Buffer.from([0x80 | bytes.length, ...bytes])
  }
  return Buffer.concat([Buffer.from([tag]), length, content])
}
const sequence = (...parts) => der(0x30, ...parts)
const hex = value => Buffer.from(value, 'hex')
const time = date => der(0x17, Buffer.from(date.toISOString().replace(/\D/g, '').slice(2, 14) + 'Z'))
const pem = (label, bytes) => `-----BEGIN ${label}-----\n${bytes.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END ${label}-----\n`

export function createTestTlsCertificate() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const algorithm = sequence(hex('06092a864886f70d01010b'), hex('0500'))
  const name = sequence(der(0x31, sequence(hex('0603550403'), der(0x0c, Buffer.from('localhost')))))
  const serialBytes = randomBytes(16)
  serialBytes[0] |= 0x80
  const serial = der(0x02, Buffer.concat([Buffer.from([0]), serialBytes]))
  const extensions = der(0xa3, sequence(
    sequence(hex('0603551d13'), hex('0101ff'), der(0x04, sequence(hex('0101ff')))),
    sequence(hex('0603551d11'), der(0x04, sequence(der(0x82, Buffer.from('localhost')), der(0x87, Buffer.from([127, 0, 0, 1]))))),
  ))
  const tbs = sequence(der(0xa0, hex('020102')), serial, algorithm, name,
    sequence(time(new Date(Date.now() - 60_000)), time(new Date(Date.now() + 24 * 60 * 60_000))),
    name, publicKey.export({ type: 'spki', format: 'der' }), extensions)
  return {
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    cert: pem('CERTIFICATE', sequence(tbs, algorithm, der(0x03, Buffer.concat([Buffer.from([0]), sign('sha256', tbs, privateKey)])))),
  }
}
