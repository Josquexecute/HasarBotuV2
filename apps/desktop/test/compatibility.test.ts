import { describe, expect, it } from 'vitest'
import { API_SERVICE_NAME, API_VERSION } from '@hasarbotu/api'
import {
  EXPECTED_API_SERVICE,
  MINIMUM_API_MINOR,
  SUPPORTED_API_MAJOR,
  checkApiCompatibility,
  parseSemanticVersion,
} from '../src/main/compatibility.js'

describe('parseSemanticVersion', () => {
  it('semver biçimini çözümler', () => {
    expect(parseSemanticVersion('0.0.0')).toEqual({ major: 0, minor: 0, patch: 0, prerelease: undefined })
    expect(parseSemanticVersion('1.4.12')).toEqual({ major: 1, minor: 4, patch: 12, prerelease: undefined })
    expect(parseSemanticVersion('0.0.0-rc.1')).toEqual({ major: 0, minor: 0, patch: 0, prerelease: 'rc.1' })
    expect(parseSemanticVersion('0.0.0+build.5')).toEqual({ major: 0, minor: 0, patch: 0, prerelease: undefined })
  })

  it('biçime uymayan değeri sessizce kabul ETMEZ', () => {
    for (const value of ['', '1', '1.2', 'v1.2.3', '1.2.3.4', 'latest', '01a.2.3', '1.2.-3']) {
      expect(parseSemanticVersion(value)).toBeNull()
    }
  })
})

describe('checkApiCompatibility', () => {
  it('GERÇEK API paket kimliğiyle uyumludur', () => {
    // Kabuk sabitlerini API'nin kendi yayımladığı değerlere karşı doğrular:
    // API sürümü ilerlerse ve kabuk güncellenmezse bu test düşer.
    expect(EXPECTED_API_SERVICE).toBe(API_SERVICE_NAME)
    expect(checkApiCompatibility(API_SERVICE_NAME, API_VERSION))
      .toEqual({ outcome: 'compatible', compatible: true })
  })

  it('yanlış servisi reddeder', () => {
    expect(checkApiCompatibility('baska-servis', '0.0.0'))
      .toEqual({ outcome: 'unknown_service', compatible: false })
  })

  it('çözümlenemeyen sürümü reddeder', () => {
    expect(checkApiCompatibility(EXPECTED_API_SERVICE, 'bilinmiyor'))
      .toEqual({ outcome: 'unparseable_version', compatible: false })
  })

  it('ana sürüm farkını reddeder', () => {
    expect(checkApiCompatibility(EXPECTED_API_SERVICE, `${SUPPORTED_API_MAJOR + 1}.0.0`))
      .toEqual({ outcome: 'incompatible_major', compatible: false })
  })

  it('0.x serisinde ikincil sürüm farkını KIRICI sayar', () => {
    // semver: `0.x` serisinde kırıcı değişiklik ikincil sürümle taşınır.
    expect(SUPPORTED_API_MAJOR).toBe(0)
    expect(checkApiCompatibility(EXPECTED_API_SERVICE, `0.${MINIMUM_API_MINOR + 1}.0`))
      .toEqual({ outcome: 'incompatible_minor', compatible: false })
  })

  it('yama sürümü ve ön sürüm etiketi uyumu etkilemez', () => {
    expect(checkApiCompatibility(EXPECTED_API_SERVICE, `${SUPPORTED_API_MAJOR}.${MINIMUM_API_MINOR}.99`).compatible).toBe(true)
    expect(checkApiCompatibility(EXPECTED_API_SERVICE, `${SUPPORTED_API_MAJOR}.${MINIMUM_API_MINOR}.0-rc.3`).compatible).toBe(true)
  })
})
