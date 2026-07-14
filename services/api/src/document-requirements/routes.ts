import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import { DOCUMENT_REQUIREMENTS_ROUTE, documentRequirementsParamsSchema, failureEnvelopeSchema, zodErrorToApiError } from '@hasarbotu/contracts'
import { requireSession } from '../auth/guard.js'
import { createAuthStore } from '../auth/store.js'
import { failureBody } from '../errors/failure.js'
import { evaluateCaseDocumentRequirements } from './evaluation.js'
export interface DocumentRequirementsRoutesOptions { readonly pool: pg.Pool }
export function registerDocumentRequirementsRoutes(app: FastifyInstance, options: DocumentRequirementsRoutesOptions): void {
  const auth = createAuthStore(options.pool)
  app.get(DOCUMENT_REQUIREMENTS_ROUTE, async (request, reply) => {
    const requestId=String(request.id); const session=await requireSession(auth,request,reply); if (session===undefined) return
    const params=documentRequirementsParamsSchema.safeParse(request.params); if(!params.success) return reply.code(400).send(failureEnvelopeSchema.parse({ok:false,error:zodErrorToApiError(params.error,requestId)}))
    const evaluatedAt=new Date().toISOString()
    const evaluation=await evaluateCaseDocumentRequirements(options.pool,session.user.organizationId,params.data.caseId,evaluatedAt)
    if(evaluation===undefined) return reply.code(404).send(failureBody('not_found','Case not found.',requestId))
    return evaluation
  })
}
