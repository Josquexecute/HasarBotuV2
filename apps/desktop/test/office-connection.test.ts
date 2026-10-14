import { describe, expect, it } from 'vitest'
import { DesktopConfigError, parseDesktopConfig } from '../src/main/config.js'
import { parseOfficeConnection } from '../src/main/office-connection.js'

const office = { schemaVersion: 1, apiOrigin: 'https://office.example.test', lanIpv4: '192.168.1.100', lanHostname: 'OFFICE-SERVER' }
describe('packaged office connection', () => {
  it('uses the packaged endpoint on a clean PC while keeping explicit configuration authoritative', () => {
    const connection = parseOfficeConnection(office)
    expect(parseDesktopConfig({}, { assetRoot: '.', apiOrigin: connection.apiOrigin }).apiOrigin).toBe(office.apiOrigin)
    expect(parseDesktopConfig({ HASARBOTU_API_ORIGIN: '  ' }, { assetRoot: '.', apiOrigin: connection.apiOrigin }).apiOrigin).toBe(office.apiOrigin)
    expect(parseDesktopConfig({ HASARBOTU_API_ORIGIN: 'https://another.example.test' }, { assetRoot: '.', apiOrigin: connection.apiOrigin }).apiOrigin).toBe('https://another.example.test')
  })
  it('rejects untrusted protocols, credentials, paths, public LAN addresses and command characters', () => {
    for (const changes of [{ apiOrigin: 'http://office.example.test' }, { apiOrigin: 'https://user:secret@office.example.test' }, { apiOrigin: 'https://office.example.test/path' }, { lanIpv4: '8.8.8.8' }, { lanIpv4: '192.168.1.999' }, { lanHostname: 'OFFICE; command' }, { token: 'never-bundled' }]) {
      expect(() => parseOfficeConnection({ ...office, ...changes })).toThrow(DesktopConfigError)
    }
  })
  it('requires a complete profile and accepts private subnet ranges', () => {
    expect(() => parseOfficeConnection({ schemaVersion: 1 })).toThrow(DesktopConfigError)
    for (const lanIpv4 of ['10.10.1.2', '172.16.5.4', '172.31.0.2']) expect(parseOfficeConnection({ ...office, lanIpv4 }).lanIpv4).toBe(lanIpv4)
    expect(() => parseOfficeConnection({ ...office, lanIpv4: '172.32.0.2' })).toThrow(DesktopConfigError)
  })
})
