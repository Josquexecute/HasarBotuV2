import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import { z } from 'zod'
import { uuidv7 } from '@hasarbotu/database'
import { legislationAiSettingsSchema, legislationAiSettingsUpdateSchema, legislationAnswerSchema, legislationHistorySchema, legislationLibrarySchema, legislationPageSchema, legislationQuestionSchema, zodErrorToApiError } from '@hasarbotu/contracts'
import { createAuthStore } from '../auth/store.js'
import { requireSession } from '../auth/guard.js'
import { hasPermission } from '../auth/permissions.js'
import { failureBody } from '../errors/failure.js'
import { withTransaction } from '../db/executor.js'
import { createAuditService } from '../audit/service.js'
import { decryptToken, encryptToken } from '../tracking/google.js'
import { catalog, retrieveLegislation, sourceSummary } from './library.js'
import { createLegalGeminiProvider, validateLegalEvidence, type LegalProvider } from './provider.js'

const defaultModel = 'gemini-3.8-flash'
const pageQuery = z.strictObject({ page: z.coerce.number().int().positive().default(1) })
const context = (org: string) => `legislation:${org}:api-key`
export function registerLegislationRoutes(app: FastifyInstance, options: { pool: pg.Pool; encryptionKey?: string; provider?: LegalProvider }) {
  const { pool, encryptionKey } = options
  const auth = createAuthStore(pool), audit = createAuditService(), provider = options.provider ?? createLegalGeminiProvider()
  // Bound paid calls per account; stale entries are removed instead of retaining every session.
  const calls = new Map<string, { start: number; count: number; busy: boolean }>()
  app.addHook('onClose', async () => { calls.clear() })
  const readSettings = async (org: string) => (await pool.query('SELECT * FROM legislation_ai_settings WHERE organization_id=$1', [org])).rows[0]
  app.get('/api/v1/legislation/library', async (request, reply) => {
    const session = await requireSession(auth, request, reply)
    if (!session) return
    const settings = await readSettings(session.user.organizationId)
    return legislationLibrarySchema.parse({ version: catalog.version, aiEnabled: !!(encryptionKey && settings?.enabled), sources: catalog.sources.map(sourceSummary) })
  })
  app.get<{ Params: { sourceId: string } }>('/api/v1/legislation/sources/:sourceId', async (request, reply) => {
    if (!await requireSession(auth, request, reply)) return
    const query = pageQuery.safeParse(request.query)
    if (!query.success) return reply.code(400).send({ ok: false, error: zodErrorToApiError(query.error, String(request.id)) })
    const source = catalog.sources.find(s => s.id === request.params.sourceId), page = source?.pages.find(p => p.page === query.data.page)
    if (!source || !page) return reply.code(404).send(failureBody('not_found', 'Kaynak veya sayfa bulunamadı.', String(request.id)))
    return legislationPageSchema.parse({ source: sourceSummary(source), page: page.page, text: page.text })
  })
  app.get('/api/v1/legislation/ai-settings', async (request, reply) => {
    const session = await requireSession(auth, request, reply)
    if (!session) return
    const row = await readSettings(session.user.organizationId)
    return legislationAiSettingsSchema.parse({ organizationId: session.user.organizationId, version: row?.version ?? 0, configured: !!row,
      enabled: !!(row?.enabled && encryptionKey), model: row?.model ?? defaultModel, canConfigure: hasPermission(session.user, 'office_admin'), encryptionAvailable: !!encryptionKey })
  })
  app.put('/api/v1/legislation/ai-settings', async (request, reply) => {
    const session = await requireSession(auth, request, reply)
    if (!session) return
    const parsed = legislationAiSettingsUpdateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ ok: false, error: zodErrorToApiError(parsed.error, String(request.id)) })
    const input = parsed.data, org = session.user.organizationId
    if (input.expectedOrganizationId !== org) return reply.code(409).send(failureBody('conflict', 'Ofis değişti. Ayarları yeniden yükleyin.', String(request.id)))
    if (!encryptionKey) return reply.code(503).send(failureBody('service_unavailable', 'Sunucuda anahtar şifrelemesi yapılandırılmamış.', String(request.id)))
    const saved = await withTransaction(pool, async db => {
      // Lock the existing parent as well: two first-time saves must not both accept version zero.
      await db.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE', [org])
      const current = (await db.query('SELECT * FROM legislation_ai_settings WHERE organization_id=$1 FOR UPDATE', [org])).rows[0]
      if ((current?.version ?? 0) !== input.expectedVersion) return { conflict: true } as const
      const encrypted = input.apiKey ? encryptToken(input.apiKey, encryptionKey, context(org)) : current?.encrypted_api_key
      if (!encrypted) return { missingKey: true } as const
      const version = input.expectedVersion + 1
      await db.query(`INSERT INTO legislation_ai_settings(organization_id,encrypted_api_key,model,enabled,version,updated_by_user_id)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(organization_id) DO UPDATE SET encrypted_api_key=excluded.encrypted_api_key,model=excluded.model,
        enabled=excluded.enabled,version=excluded.version,updated_by_user_id=excluded.updated_by_user_id,updated_at=now()`, [org, encrypted, input.model, input.enabled, version, session.user.id])
      await audit.record(db, { organizationId: org, actorUserId: session.user.id, action: 'legislation.ai_settings_updated', entityType: 'organization', entityId: org, requestId: String(request.id),
        details: { fromVersion: input.expectedVersion, toVersion: version, enabled: input.enabled, model: input.model, keyChanged: !!input.apiKey } })
      return legislationAiSettingsSchema.parse({ organizationId: org, version, configured: true, enabled: input.enabled, model: input.model, canConfigure: true, encryptionAvailable: true })
    })
    if ('conflict' in saved) return reply.code(409).send(failureBody('conflict', 'Ayarlar değişti. Yeniden yükleyin.', String(request.id)))
    if ('missingKey' in saved) return reply.code(400).send(failureBody('validation_error', 'İlk kurulumda Gemini API anahtarı gerekir.', String(request.id)))
    return saved
  })
  app.get('/api/v1/legislation/history', async (request, reply) => {
    const session = await requireSession(auth, request, reply)
    if (!session) return
    const result = await pool.query(`SELECT answer FROM legislation_answers WHERE organization_id=$1 AND user_id=$2 ORDER BY created_at DESC,id DESC LIMIT 20`, [session.user.organizationId, session.user.id])
    return legislationHistorySchema.parse({ items: result.rows.map(row => row.answer) })
  })
  app.post('/api/v1/legislation/questions', async (request, reply) => {
    const session = await requireSession(auth, request, reply)
    if (!session) return
    const parsed = legislationQuestionSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ ok: false, error: zodErrorToApiError(parsed.error, String(request.id)) })
    const input = parsed.data, org = session.user.organizationId
    if (input.sourceIds.some(id => !catalog.sources.some(source => source.id === id))) return reply.code(400).send(failureBody('validation_error', 'Seçilen kaynak bulunamadı.', String(request.id)))
    const missingInformation = ['Metinler doğrulama tarihindeki kaynak görüntüsüdür. Olay ve poliçe tarihine uygulanacak sürüm ayrıca kontrol edilmelidir.']
    if (!input.eventDate) missingInformation.push('Olay tarihi belirtilmedi.')
    if (input.caseId) {
      const claim = (await pool.query('SELECT case_type FROM cases WHERE organization_id=$1 AND id=$2 AND is_archived=false', [org, input.caseId])).rows[0]
      if (!claim) return reply.code(404).send(failureBody('not_found', 'Dosya bulunamadı.', String(request.id)))
      if (!claim.case_type) missingInformation.push('Dosyanın Trafik/Kasko türü henüz seçilmedi.')
    }
    const evidence = retrieveLegislation(input)
    if (!evidence.length) missingInformation.push('Bu soru ve tarihe uygun, son 14 günde doğrulanmış dayanak bulunamadı. Kaynakları daraltın veya kütüphaneyi yenileyin.')
    let statements = evidence.map(item => ({ text: item.excerpt.slice(0, 1000), citationIds: [item.id] }))
    let citations = evidence
    let usedProvider: { name: 'gemini'; model: string } | null = null
    if (input.mode === 'ai') {
      const settings = await readSettings(org)
      if (!settings?.enabled || !encryptionKey) return reply.code(503).send(failureBody('service_unavailable', 'Gemini bağlantısı etkin değil. Kaynak taramasını kullanabilirsiniz.', String(request.id)))
      if (evidence.length) {
        const now = Date.now(), key = `${org}:${session.user.id}`
        for (const [id, state] of calls) if (!state.busy && now - state.start >= 60_000) calls.delete(id)
        const state = calls.get(key) ?? { start: now, count: 0, busy: false }
        if (state.busy || state.count >= 5 || calls.size >= 1000 && !calls.has(key)) return reply.code(429).send(failureBody('rate_limited', 'AI isteği sürüyor veya dakika sınırına ulaşıldı.', String(request.id)))
        state.busy = true;state.count++;calls.set(key, state)
        try {
          const output = validateLegalEvidence(await provider(input, evidence, { apiKey: decryptToken(settings.encrypted_api_key, encryptionKey, context(org)), model: settings.model }), evidence)
          usedProvider = { name: 'gemini', model: settings.model }
          statements = output.statements.map(statement => ({ text: statement.text, citationIds: [...new Set(statement.citations.map(c => c.id))] }))
          const used = new Set(statements.flatMap(s => s.citationIds))
          citations = evidence.filter(e => used.has(e.id)).map(e => ({ ...e, excerpt: [...new Set(output.statements.flatMap(s => s.citations).filter(c => c.id === e.id).map(c => c.quote))].join('\n') }))
          missingInformation.push(...output.missingInformation)
          if (!statements.length) missingInformation.push('AI bu kaynaklarla desteklenen bir tespit üretemedi.')
        } catch (error) {
          // Provider errors may contain remote credentials or input. Return only a safe diagnostic.
          const diagnostic = error instanceof Error && /^legal_provider_(?:http_\d{3}|empty|response_limit|invalid|incomplete|unsupported_citation)$/.test(error.message) ? error.message : 'legal_provider_failed'
          request.log.warn({ diagnostic }, 'Legislation provider rejected')
          return reply.code(502).send(failureBody('service_unavailable', 'Gemini yanıtı alınamadı veya kaynak doğrulamasını geçemedi. Anahtarı, modeli ve kotayı kontrol edin.', String(request.id)))
        } finally { state.busy = false }
      }
    }
    const answer = legislationAnswerSchema.parse({ id: uuidv7(), mode: input.mode, createdAt: new Date().toISOString(), question: input.question,
      eventDate: input.eventDate, caseId: input.caseId, libraryVersion: catalog.version, provider: usedProvider, statements, citations, missingInformation, requiresReview: true })
    await withTransaction(pool, async db => {
      await db.query('INSERT INTO legislation_answers(id,organization_id,user_id,case_id,answer,created_at) VALUES($1,$2,$3,$4,$5::jsonb,$6)', [answer.id, org, session.user.id, input.caseId, JSON.stringify(answer), answer.createdAt])
      await audit.record(db, { organizationId: org, actorUserId: session.user.id, requestId: String(request.id), action: 'legislation.answer_created', entityType: 'legislation_answer', entityId: answer.id,
        details: { mode: answer.mode, provider: usedProvider, libraryVersion: answer.libraryVersion, citationCount: answer.citations.length, requiresReview: true } })
    })
    return answer
  })
}
