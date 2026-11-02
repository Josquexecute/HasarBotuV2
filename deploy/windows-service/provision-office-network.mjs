import { execFileSync } from 'node:child_process'
import { readFile, writeFile, mkdir, access, copyFile, rename } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { X509Certificate, createHash, createPrivateKey, createPublicKey } from 'node:crypto'

export function gatewayCaddy(profile, directory, certificateBase = 'server') {
  const host = new URL(profile.apiOrigin).hostname
  if (!/^[a-z0-9.-]+$/i.test(host) || !Number.isInteger(profile.httpsPort) || profile.httpsPort < 1024 || profile.httpsPort > 65535) throw Error('INVALID_PROFILE')
  if (!/^server(?:-[a-f0-9]{64})?$/.test(certificateBase)) throw Error('INVALID_CERTIFICATE_PATH')
  const safe = file => { const value = join(directory, file).replaceAll('\\', '/'); if (/["\r\n]/.test(value)) throw Error('UNSAFE_PATH'); return `"${value}"` }
  return `{
  admin off
  auto_https off
  servers {
    protocols h1 h2
  }
}
https://${host}:${profile.httpsPort} {
  bind 0.0.0.0
  tls ${safe(certificateBase + '.crt')} ${safe(certificateBase + '.key')}
  @api path /health /api /api/*
  handle @api {
    reverse_proxy 127.0.0.1:3100 {
      header_up X-Forwarded-For {remote_host}
      header_up -X-Forwarded-Host
      header_up -X-Forwarded-Proto
      header_up -Tailscale-User-Login
      header_up -Tailscale-User-Name
      header_up -Tailscale-User-Profile-Pic
      transport http {
        response_header_timeout 120s
      }
    }
  }
  handle {
    respond 404
  }
}
`
}

/** Run only inside an administrator-protected directory on the server. Never export private keys. */
export async function provisionOfficeNetwork({ directory, openssl, apiOrigin, lanHostname, httpsPort = 8443, discoveryPort = 43110, remoteOrigin, renew = false }) {
  const origin = new URL(apiOrigin)
  if (origin.protocol !== 'https:' || origin.origin !== apiOrigin || origin.port || !/^[a-z0-9.-]+$/i.test(origin.hostname)
    || /^\d+[.\d]*$/.test(origin.hostname) || !/^[a-z0-9][a-z0-9-]{0,62}$/i.test(lanHostname)
    || ![httpsPort, discoveryPort].every(port => Number.isInteger(port) && port >= 1024 && port <= 65535)) throw Error('INVALID_PROFILE')
  if (remoteOrigin) {
    const remote = new URL(remoteOrigin)
    if (remote.protocol !== 'https:' || remote.origin !== remoteOrigin || remote.username || remote.password
      || /^\d+[.\d]*$/.test(remote.hostname) || !/^[a-z0-9.-]+$/i.test(remote.hostname)) throw Error('INVALID_REMOTE_ORIGIN')
  }
  await mkdir(directory, { recursive: true })
  const file = name => join(directory, name)
  const exists = async name => { try { await access(file(name)); return true } catch (error) { if (error.code === 'ENOENT') return false; throw error } }
  const run = args => execFileSync(openssl, args, { cwd: directory, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], timeout: 60_000 })
  let saved
  if (await exists('client-profile.json')) {
    saved = JSON.parse(await readFile(file('client-profile.json'), 'utf8'))
    if (saved.apiOrigin !== apiOrigin || saved.lanHostname !== lanHostname || saved.httpsPort !== httpsPort || saved.discoveryPort !== discoveryPort) throw Error('EXISTING_PROFILE_DIFFERS')
    // A normal reinstall/renewal preserves the optional remote route; an explicit administrator value may update it.
    if (remoteOrigin === undefined) remoteOrigin = saved.remoteOrigin
  }
  // Keep the already configured optional tailnet path during migration; LAN never uses it when available.
  if (!saved && remoteOrigin === undefined && origin.hostname.endsWith('.ts.net')) remoteOrigin = apiOrigin
  const hasCa = await exists('ca.crt'), hasKey = await exists('ca.key')
  if (hasCa !== hasKey) throw Error('INCOMPLETE_CA_REFUSING_REPLACEMENT')
  if (saved && !hasCa) throw Error('EXISTING_CA_MISSING_REFUSING_REPLACEMENT')
  if (!hasCa) {
    run(['req', '-x509', '-newkey', 'rsa:3072', '-sha256', '-nodes', '-days', '3650', '-keyout', 'ca.key', '-out', 'ca.crt',
      '-subj', '/CN=HasarBotu Office Network CA', '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:0', '-addext', 'keyUsage=critical,keyCertSign,cRLSign'])
  }
  const caCertificate = await readFile(file('ca.crt'), 'utf8'), ca = new X509Certificate(caCertificate)
  if (saved && saved.caCertificate !== caCertificate) throw Error('CA_PIN_MISMATCH')
  if (!ca.ca || Date.parse(ca.validTo) - Date.now() < 90 * 86400_000) throw Error('CA_REPLACEMENT_REQUIRED')
  let certificateCurrent = false
  let certificateBase
  if (await exists('certificate-current.json')) {
    certificateBase = JSON.parse(await readFile(file('certificate-current.json'), 'utf8')).certificateBase
    if (!/^server-[a-f0-9]{64}$/.test(certificateBase)) throw Error('INVALID_CERTIFICATE_PATH')
    const cert = new X509Certificate(await readFile(file(certificateBase + '.crt')))
    const publicKey = createPublicKey(createPrivateKey(await readFile(file(certificateBase + '.key')))).export({ type: 'spki', format: 'der' })
    if (!publicKey.equals(cert.publicKey.export({ type: 'spki', format: 'der' }))) throw Error('CERTIFICATE_KEY_MISMATCH')
    certificateCurrent = cert.checkHost(origin.hostname) === origin.hostname && cert.verify(ca.publicKey) && Date.parse(cert.validTo) - Date.now() > 30 * 86400_000
  }
  if (!certificateCurrent) {
    if (!renew && certificateBase) throw Error('SERVER_CERTIFICATE_RENEWAL_REQUIRED')
    await writeFile(file('server.ext'), `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:${origin.hostname}\n`)
    run(['req', '-new', '-newkey', 'rsa:3072', '-sha256', '-nodes', '-keyout', 'server.next.key', '-out', 'server.csr', '-subj', `/CN=${origin.hostname}`])
    run(['x509', '-req', '-in', 'server.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'server.next.crt', '-days', '397', '-sha256', '-extfile', 'server.ext'])
    const certificate = await readFile(file('server.next.crt'))
    const leaf = new X509Certificate(certificate)
    if (leaf.checkHost(origin.hostname) !== origin.hostname || !leaf.verify(ca.publicKey)) throw Error('NEW_CERTIFICATE_INVALID')
    certificateBase = 'server-' + createHash('sha256').update(certificate).digest('hex')
    // Immutable pairs prevent a reboot between two renames from mixing keys/certificates.
    await copyFile(file('server.next.key'), file(certificateBase + '.key'))
    await copyFile(file('server.next.crt'), file(certificateBase + '.crt'))
  }
  const profile = { schemaVersion: 2, apiOrigin, lanHostname, httpsPort, discoveryPort, caCertificate, ...(remoteOrigin ? { remoteOrigin } : {}) }
  const atomicWrite = async (name, content) => { await writeFile(file(name + '.next'), content); await rename(file(name + '.next'), file(name)) }
  const caddyfile = gatewayCaddy(profile, directory, certificateBase)
  if (await exists('Caddyfile') && await readFile(file('Caddyfile'), 'utf8') !== caddyfile) {
    await copyFile(file('Caddyfile'), file('Caddyfile.previous'))
    if (await exists('certificate-current.json')) await copyFile(file('certificate-current.json'), file('certificate-current.json.previous'))
  }
  await atomicWrite('Caddyfile', caddyfile)
  await atomicWrite('certificate-current.json', JSON.stringify({ certificateBase }))
  await atomicWrite('client-profile.json', JSON.stringify(profile, null, 2))
  return { profile, certificateChanged: !certificateCurrent }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const config = JSON.parse(await readFile(process.argv[2], 'utf8'))
    const result = await provisionOfficeNetwork({ ...config, renew: process.argv.includes('--renew') })
    console.log(JSON.stringify({ status: 'PROVISIONED', certificateChanged: result.certificateChanged }))
  } catch (error) { console.error(JSON.stringify({ status: 'FAILED', code: error.code ?? (error.stderr ? 'OPENSSL_FAILED' : error.message) })); process.exitCode = 1 }
}
