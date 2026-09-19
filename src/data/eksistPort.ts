import type { QuickCaseCreate } from '@hasarbotu/contracts'
import type { EksistExtraction } from '@hasarbotu/domain'
import { CaseCommandError } from './commandPort'
import { mapCaseDtoToRecord } from './httpAdapter'
import type { CaseRecord } from '../types/case'
import type { WorkspaceProvisioningRecord } from './workspacePort'

export interface EksistSource { id: string; extraction: EksistExtraction; text: string; method: string }
export interface QuickCreation { case: CaseRecord; provisioning: WorkspaceProvisioningRecord | null; duplicate: boolean }
export interface EksistPort {
  readSource(input: { kind: 'text'; text: string } | { kind: 'pdf' | 'image'; name: string; base64: string }): Promise<EksistSource>
  create(input: QuickCaseCreate, key: string): Promise<QuickCreation>
}
export function createEksistPort(): EksistPort {
  async function post(path: string, body: unknown, key?: string) {
    let response: Response
    try { response = await fetch(`/api/v1/${path}`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) }, body: JSON.stringify(body) }) }
    catch { throw new CaseCommandError('unavailable', 'Connection failed') }
    const data = await response.json()
    if (!response.ok) throw new CaseCommandError(response.status === 401 ? 'unauthorized' : response.status === 400 ? 'validation' : response.status === 409 ? 'idempotency_conflict' : 'unavailable', 'Request failed', data.error?.fieldErrors?.map((item: { path: string; code: string }) => ({ ...item, path: item.path.replace(/^(case|vehicle)\./, '').replace(/^source\.reference$/, 'reference') })) ?? [])
    return data
  }
  return {
    readSource: input => post('eksist/sources', input),
    async create(input, key) {
      const data = await post('cases/quick-create', input, key)
      const { caseDetailResponseSchema, workspaceProvisioningSchema } = await import('@hasarbotu/contracts')
      return { case: mapCaseDtoToRecord(caseDetailResponseSchema.parse({ case: data.case }).case), provisioning: data.provisioning === null ? null : workspaceProvisioningSchema.parse(data.provisioning), duplicate: data.duplicate === true }
    },
  }
}
