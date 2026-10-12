import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import { z } from 'zod'
import { uuidv7 } from '@hasarbotu/database'
import { toOfficeDate } from '@hasarbotu/domain'
import { managedServicesSchema,serviceEditSchema,managedServiceSchema,managedDocumentRulesSchema,documentRuleConfigurationSchema,permissionMapSchema,rolePolicySchema } from '@hasarbotu/contracts'
import { createAuthStore } from '../auth/store.js'
import { requireSession,requireAnyRole } from '../auth/guard.js'
import { loadRolePolicy } from '../auth/permissions.js'
import { createAuditService } from '../audit/service.js'
import { withTransaction } from '../db/executor.js'
import { failureBody } from '../errors/failure.js'
import { loadDocumentRequirementRules } from '../document-requirements/rules.js'

class AdministrationError extends Error {
  constructor(readonly status: 404 | 409,message: string) { super(message) }
}
const fields = 'id,name,service_type AS "serviceType",phone,is_active AS "isActive",version'
const today = () => toOfficeDate(new Date())
export function registerAdministrationRoutes(app: FastifyInstance,{ pool }: { pool: pg.Pool }) {
  const auth = createAuthStore(pool),audit = createAuditService()
  void app.register(async (routes) => {
    routes.setErrorHandler((error,request,reply) => {
      if (error instanceof z.ZodError) return reply.code(400).send(failureBody('validation_error','Alanları kontrol edin.',String(request.id)))
      if (error instanceof AdministrationError) return reply.code(error.status).send(failureBody(error.status === 409 ? 'conflict' : 'not_found',error.message,String(request.id)))
      if ((error as { code?: unknown }).code === '23505') return reply.code(409).send(failureBody('conflict','Bu isimle bir kayıt zaten var.',String(request.id)))
      throw error
    })
    routes.get('/api/v1/administration/services',async (request,reply) => {
      const session = await requireAnyRole(auth,request,reply,['admin'])
      if (!session) return
      return managedServicesSchema.parse({ items: (await pool.query(`SELECT ${fields} FROM service_centers WHERE organization_id=$1 ORDER BY name,id`,[session.user.organizationId])).rows })
    })
    routes.post('/api/v1/administration/services',async (request,reply) => {
      const session = await requireAnyRole(auth,request,reply,['admin'])
      if (!session) return
      const input = serviceEditSchema.parse(request.body)
      const item = await withTransaction(pool,async (db) => {
        const row = (await db.query(`INSERT INTO service_centers(id,organization_id,name,center_type,service_type,phone,is_active)
          VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING ${fields}`,[uuidv7(),session.user.organizationId,input.name,input.serviceType === 'authorized' ? 'yetkili' : 'ozel',input.serviceType,input.phone,input.isActive])).rows[0]
        await audit.record(db,{ organizationId: session.user.organizationId,actorUserId: session.user.id,requestId: String(request.id),action: 'service.created',entityType: 'service',entityId: row.id,details: { serviceType: input.serviceType,isActive: input.isActive } })
        return managedServiceSchema.parse(row)
      })
      return reply.code(201).send({ item })
    })
    routes.post('/api/v1/administration/services/:id',async (request,reply) => {
      const session = await requireAnyRole(auth,request,reply,['admin'])
      if (!session) return
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
      const input = serviceEditSchema.extend({ expectedVersion: z.number().int().positive() }).parse(request.body)
      const item = await withTransaction(pool,async (db) => {
        const before = (await db.query('SELECT version FROM service_centers WHERE organization_id=$1 AND id=$2 FOR UPDATE',[session.user.organizationId,id])).rows[0]
        if (!before) throw new AdministrationError(404,'Servis bulunamadı.')
        if (before.version !== input.expectedVersion) throw new AdministrationError(409,'Servis değişmiş. Listeyi yenileyin.')
        const row = (await db.query(`UPDATE service_centers SET name=$3,service_type=$4,center_type=$5,phone=$6,is_active=$7,version=version+1,updated_at=now()
          WHERE organization_id=$1 AND id=$2 RETURNING ${fields}`,[session.user.organizationId,id,input.name,input.serviceType,input.serviceType === 'authorized' ? 'yetkili' : 'ozel',input.phone,input.isActive])).rows[0]
        await audit.record(db,{ organizationId: session.user.organizationId,actorUserId: session.user.id,requestId: String(request.id),action: 'service.updated',entityType: 'service',entityId: id,details: { serviceType: input.serviceType,isActive: input.isActive,fromVersion: before.version,toVersion: row.version } })
        return managedServiceSchema.parse(row)
      })
      return { item }
    })
    routes.get('/api/v1/administration/document-rules',async (request,reply) => {
      const session = await requireSession(auth,request,reply)
      if (!session) return
      const rules = await loadDocumentRequirementRules(pool,session.user.organizationId,today())
      return managedDocumentRulesSchema.parse({ items: [...rules].map(([caseType,value]) => ({ caseType,versionId: value.versionId,configuration: value.rule.configuration })) })
    })
    routes.post('/api/v1/administration/document-rules/:caseType',async (request,reply) => {
      const session = await requireAnyRole(auth,request,reply,['admin'])
      if (!session) return
      const { caseType } = z.object({ caseType: z.enum(['traffic','casco']) }).parse(request.params)
      const input = z.object({ expectedVersionId: z.string().uuid(),configuration: documentRuleConfigurationSchema }).strict().parse(request.body)
      await withTransaction(pool,async (db) => {
        // All policy writers in a tenant serialize, including first-version creation.
        await db.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[session.user.organizationId])
        const current = (await loadDocumentRequirementRules(db,session.user.organizationId,today())).get(caseType)
        if (!current || current.versionId !== input.expectedVersionId) throw new AdministrationError(409,'Kural değişmiş. Listeyi yenileyin.')
        const set = (await db.query(`INSERT INTO document_rule_sets(id,organization_id,code,case_type,status,source_reference)
          VALUES($1,$2,'office-document-requirements',$3,'active','office-policy') ON CONFLICT(organization_id,code,case_type) DO NOTHING RETURNING id`,[uuidv7(),session.user.organizationId,caseType])).rows[0]
          ?? (await db.query("SELECT id FROM document_rule_sets WHERE organization_id=$1 AND case_type=$2 AND code='office-document-requirements'",[session.user.organizationId,caseType])).rows[0]
        const versionId = uuidv7()
        await db.query(`INSERT INTO document_rule_versions(id,rule_set_id,version,effective_from,conditions,requirements,source_reference,status)
          VALUES($1::uuid,$2,$1::text,$3,'{}',$4,'office-policy','active')`,[versionId,set.id,today(),JSON.stringify({ configuration: input.configuration })])
        await audit.record(db,{ organizationId: session.user.organizationId,actorUserId: session.user.id,requestId: String(request.id),action: 'document_rules.updated',entityType: 'document_rule_version',entityId: versionId,details: { caseType,previousVersionId: current.versionId,configuration: input.configuration } })
      })
      return reply.code(204).send()
    })
    routes.get('/api/v1/administration/permissions',async (request,reply) => {
      const session = await requireSession(auth,request,reply)
      if (!session) return
      return loadRolePolicy(pool,session.user.organizationId)
    })
    routes.post('/api/v1/administration/permissions',async (request,reply) => {
      const session = await requireAnyRole(auth,request,reply,['admin'])
      if (!session) return
      const input = z.object({ expectedVersion: z.number().int().nonnegative(),permissions: permissionMapSchema }).strict().parse(request.body)
      const result = await withTransaction(pool,async (db) => {
        await db.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[session.user.organizationId])
        const current = await loadRolePolicy(db,session.user.organizationId)
        if (current.version !== input.expectedVersion) throw new AdministrationError(409,'Yetkiler değişmiş. Listeyi yenileyin.')
        const next = rolePolicySchema.parse({ version: current.version+1,permissions: input.permissions })
        await db.query(`INSERT INTO organization_role_policies(organization_id,version,permissions) VALUES($1,$2,$3)
          ON CONFLICT(organization_id) DO UPDATE SET version=excluded.version,permissions=excluded.permissions,updated_at=now()`,[session.user.organizationId,next.version,JSON.stringify(next.permissions)])
        await audit.record(db,{ organizationId: session.user.organizationId,actorUserId: session.user.id,requestId: String(request.id),action: 'permissions.updated',entityType: 'organization',entityId: session.user.organizationId,details: { previous: current.permissions,current: next.permissions,version: next.version } })
        return next
      })
      return result
    })
  })
}
