import { valueLossCalculatorResponseSchema, type ValueLossCalculatorRequest, type ValueLossCalculatorResponse } from '@hasarbotu/contracts'
import { createHttpTrafficValueLossAdapter, TrafficValueLossError, type TrafficValueLossVersionRecord, type TrafficValueLossPartCatalogRecord, type TrafficValueLossEvidenceRecord } from './trafficValueLossPort'

export type CalculatorSavedInput = TrafficValueLossVersionRecord['input'] & {
  readonly historyEvidence?: readonly TrafficValueLossEvidenceRecord[]
  readonly partLabels?: Readonly<Record<string, string>>
}

export interface ValueLossCalculatorPort {
  load(caseId: string): Promise<CalculatorSavedInput | null>
  catalog(caseId: string, group: TrafficValueLossPartCatalogRecord['vehicleGroupCode']): Promise<TrafficValueLossPartCatalogRecord>
  calculate(caseId: string, input: ValueLossCalculatorRequest): Promise<ValueLossCalculatorResponse>
}

export function createHttpValueLossCalculatorAdapter(options: { readonly fetchImpl?: typeof fetch; readonly baseUrl?: string } = {}): ValueLossCalculatorPort {
  const legacy = createHttpTrafficValueLossAdapter(options)
  return {
    async load(caseId) {
      const { assessment } = await legacy.load(caseId)
      if (!assessment) return null
      const version = assessment.currentVersion
      return { ...version.input, historyEvidence: version.evidence, partLabels: Object.fromEntries((version.evaluation.partBreakdown ?? []).map(part => [part.stableRuleId, part.sourceLabel])) }
    },
    async catalog(caseId, group) { return legacy.partCatalog!(caseId, group) },
    async calculate(caseId, input) {
      let response: Response
      try {
        response = await (options.fetchImpl ?? fetch)(`${options.baseUrl ?? ''}/api/v1/cases/${encodeURIComponent(caseId)}/traffic-value-loss/calculate`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(input) })
      } catch { throw new TrafficValueLossError('unavailable', 'Calculator unavailable') }
      if (!response.ok) throw new TrafficValueLossError(response.status === 401 ? 'unauthorized' : response.status === 403 ? 'forbidden' : response.status === 400 ? 'validation' : response.status === 404 ? 'not_found' : 'unavailable', 'Calculator request failed')
      try { return valueLossCalculatorResponseSchema.parse(await response.json()) }
      catch { throw new TrafficValueLossError('unavailable', 'Invalid calculator response') }
    },
  }
}
