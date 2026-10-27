import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { assistantAppearanceSchema, caseListItemSchema, caseVehicleProfileResponseSchema, caseVehicleProfileVersionSchema, fileOperationSchema, linkedFileOperationSchema, DEFAULT_ASSISTANT_APPEARANCE } from '@hasarbotu/contracts'
import { buildApp } from '../src/app.js'
import { isLegacyDesktop, legacyDesktopResponse } from '../src/legacy-desktop-responses.js'

const oldAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) @hasarbotu/desktop/0.1.72 Chrome/152.0.7977.167 Electron/44.9.1 Safari/537.36'
const item = { id: 'case-1', caseType: 'casco', officeCaseNumber: '2026/1', notificationFormNumber: null, insurerClaimNumber: null, plate: '34 TEST 01', status: 'open', stage: 'inspection_pending', responsibleUserId: null, expertUserId: null, serviceId: null, serviceProfile: null, insurerId: null, followUpDate: null, lossDate: null, notificationDate: null, lastInterventionAt: null, createdAt: '2026-10-22T08:00:00Z', updatedAt: '2026-10-22T08:00:00Z', version: 1, transmission: 'automatic' }
const profile = { id: 'profile-1', profileVersion: 1, previousVersionId: null, schemaVersion: 'case-vehicle-profile/1.0.0', brand: 'Ford', model: 'Focus', modelYear: 2020, variant: null, vehicleClass: 'passenger_car', chassisPrefix: null, engineCode: null, evidenceSource: 'user_statement', evidenceReference: null, revisionReason: null, createdByUserId: 'user-1', createdAt: '2026-10-22T08:00:00Z', transmission: 'automatic' }
const operation = { id: 'operation-1', caseId: 'case-1', operationType: 'move_case_workspace', source: { storageRootKey: 'root-1', relativePath: '2026/A' }, destination: { storageRootKey: 'root-2', relativePath: '2026/A' }, expectedLocationVersion: 1, status: 'failed', strategy: 'atomic_rename', manifestHash: null, fileCount: null, directoryCount: null, totalBytes: null, cleanupState: 'not_required', failureReasonCode: 'source_locked', fileLock: { applications: [], truncated: false }, version: 1, canApprove: false, canCancel: true, approvedAt: null, finalizedAt: null, createdAt: '2026-10-22T08:00:00Z', updatedAt: '2026-10-22T08:00:00Z' }
const apps: ReturnType<typeof buildApp>[] = []
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())) })

describe('0.1.72 strict desktop wire compatibility', () => {
  it('recognizes only known older packaged Electron product versions', () => {
    for (const version of ['0.0.9', '0.1.1', '0.1.72']) expect(isLegacyDesktop(oldAgent.replace('0.1.72', version))).toBe(true)
    expect(isLegacyDesktop(oldAgent.replace('@hasarbotu/desktop', 'HasarBotu'))).toBe(true)
    for (const agent of [undefined, 'Mozilla/5.0', oldAgent.replace('0.1.72', '0.1.73'), oldAgent.replace('0.1.72', '0.2.0'), oldAgent.replace('0.1.72', '1.0.0'), oldAgent.replace('Electron/44.9.1', 'Browser/44.9.1')]) expect(isLegacyDesktop(agent)).toBe(false)
  })
  it('keeps actual old strict case and appearance schemas readable without changing source objects', () => {
    const oldCase = caseListItemSchema.omit({ transmission: true })
    const oldAppearance = assistantAppearanceSchema.omit({ customImage: true })
    expect(oldCase.safeParse(item).success).toBe(false)
    const appearance = { ...DEFAULT_ASSISTANT_APPEARANCE, customImage: 'data:image/png;base64,AA==' }
    expect(oldAppearance.safeParse(appearance).success).toBe(false)
    const list = legacyDesktopResponse('/api/v1/cases', { items: [item], metadata: { transmission: 'preserve arbitrary data' } }) as { items: unknown[]; metadata: unknown }
    expect(oldCase.safeParse(list.items[0]).success).toBe(true)
    expect(list.metadata).toEqual({ transmission: 'preserve arbitrary data' })
    for (const route of ['/api/v1/cases/:caseId', '/api/v1/cases', '/api/v1/cases/quick-create', '/api/v1/eksist/import']) {
      expect(oldCase.safeParse((legacyDesktopResponse(route, { case: item }) as { case: unknown }).case).success).toBe(true)
    }
    expect(oldAppearance.safeParse((legacyDesktopResponse('/api/v1/me/assistant-appearance', { appearance }) as { appearance: unknown }).appearance).success).toBe(true)
    expect(item.transmission).toBe('automatic')
    expect(appearance.customImage).toBeTruthy()
  })
  it('removes extensions only at vehicle profile and operation DTO paths', () => {
    const oldVersion = caseVehicleProfileVersionSchema.omit({ transmission: true })
    const oldProfile = caseVehicleProfileResponseSchema.omit({ transmission: true }).extend({ current: oldVersion.nullable(), history: z.array(oldVersion) })
    const payload = { caseId: 'case-1', transmission: 'automatic', profileId: 'profile-1', version: 1, current: profile, history: [profile], permissions: { canEdit: true } }
    expect(oldProfile.safeParse(payload).success).toBe(false)
    expect(oldProfile.safeParse(legacyDesktopResponse('/api/v1/cases/:caseId/vehicle-profile', payload)).success).toBe(true)
    const oldOperation = fileOperationSchema.omit({ fileLock: true })
    expect(fileOperationSchema.safeParse(operation).success).toBe(true)
    expect(oldOperation.safeParse(operation).success).toBe(false)
    for (const route of ['/api/v1/cases/:caseId/file-operations', '/api/v1/cases/:caseId/file-operations/:operationId', '/api/v1/cases/:caseId/workspace-month-plan']) {
      expect(oldOperation.safeParse((legacyDesktopResponse(route, { operation }) as { operation: unknown }).operation).success).toBe(true)
    }
    const linked = { id: 'operation-1', status: 'failed', fileLock: null }
    const oldLinked = linkedFileOperationSchema.unwrap().omit({ fileLock: true })
    expect(oldLinked.safeParse(linked).success).toBe(false)
    const lifecycle = legacyDesktopResponse('/api/v1/cases/:caseId/lifecycle-operations', { items: [{ linkedFileOperation: linked, details: { fileLock: 'preserve arbitrary data' } }] }) as { items: { linkedFileOperation: unknown; details: unknown }[] }
    expect(oldLinked.safeParse(lifecycle.items[0]!.linkedFileOperation).success).toBe(true)
    expect(lifecycle.items[0]!.details).toEqual({ fileLock: 'preserve arbitrary data' })
  })
  it('negotiates real Fastify responses, preserves current/no-UA responses and existing Vary', async () => {
    const app = buildApp({ loggerEnabled: false }); apps.push(app)
    app.get('/api/v1/cases/:caseId', async (_request, reply) => { reply.header('Vary', 'Accept-Encoding'); return { case: item } })
    app.get('/api/v1/metadata', async () => ({ transmission: 'untouched', customImage: 'untouched' }))
    app.get('/api/v1/me/assistant-appearance', async (_request, reply) => {
      reply.header('Vary', 'Accept-Encoding')
      return { appearance: { ...DEFAULT_ASSISTANT_APPEARANCE, eyeColor: '#22cc88', customImage: null } }
    })
    app.get('/api/v1/cases/:caseId/notice-sheet', async (_request, reply) => {
      reply.header('Vary', 'x-hasarbotu-notice-sheet-fields')
      return { defaults: { fields: {} } }
    })
    for (const version of ['0.1.72', '0.1.75', '0.1.76', '0.1.77']) {
      const response = await app.inject({ url: '/api/v1/me/assistant-appearance', headers: { 'user-agent': oldAgent.replace('0.1.72', version) } })
      expect(response.statusCode).toBe(200)
      expect(Object.hasOwn(response.json().appearance, 'eyeColor')).toBe(version === '0.1.77')
      expect(Object.hasOwn(response.json().appearance, 'customImage')).toBe(version !== '0.1.72')
      expect(response.headers.vary).toBe('Accept-Encoding, User-Agent')
      expect(assistantAppearanceSchema.omit({ eyeColor: true }).safeParse(response.json().appearance).success).toBe(version !== '0.1.77')
    }
    for (const userAgent of [oldAgent, oldAgent.replace('0.1.72', '0.1.73'), undefined]) {
      const response = await app.inject({ url: '/api/v1/cases/case-1', headers: userAgent ? { 'user-agent': userAgent } : {} })
      expect(response.statusCode).toBe(200)
      expect(Object.hasOwn(response.json().case, 'transmission')).toBe(userAgent !== oldAgent)
      expect(response.headers.vary).toBe('Accept-Encoding, User-Agent')
    }
    expect((await app.inject({ url: '/api/v1/metadata', headers: { 'user-agent': oldAgent } })).json()).toEqual({ transmission: 'untouched', customImage: 'untouched' })
    const notice = await app.inject({ url: '/api/v1/cases/case-1/notice-sheet', headers: { 'user-agent': oldAgent } })
    expect(notice.headers.vary).toBe('x-hasarbotu-notice-sheet-fields')
    expect(notice.json()).toEqual({ defaults: { fields: {} } })
  })
})
