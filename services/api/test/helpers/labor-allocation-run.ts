import type { FastifyInstance } from 'fastify'

/**
 * Paket 62 — `analyze` artık hemen `queued` döner ve iş arka planda çalışır.
 *
 * Testlerin sonuca ilişkin iddiaları değişmesin diye bu yardımcı run terminal
 * duruma gelene kadar bekler ve aynı şekle sahip bir yanıt döndürür. Gerçek
 * uçtaki asenkron davranış korunur; yalnız test kodu sonucu bekler.
 */
const ACTIVE_STATUSES = new Set(['queued', 'running', 'cancel_requested'])

export interface RunLikeResponse {
  readonly statusCode: number
  json(): unknown
}

export async function waitForRunTerminal(
  app: FastifyInstance,
  cookie: string,
  caseId: string,
  started: RunLikeResponse,
  timeoutMs = 20_000,
): Promise<RunLikeResponse> {
  if (started.statusCode !== 200) return started
  const body = started.json() as { run?: { id?: string; status?: string } }
  const runId = body.run?.id
  if (runId === undefined) return started

  const deadline = Date.now() + timeoutMs
  let latest = started
  for (;;) {
    const current = latest.json() as { run?: { status?: string } }
    const status = current.run?.status ?? ''
    if (!ACTIVE_STATUSES.has(status)) return latest
    if (Date.now() > deadline) {
      throw new Error(`RUN_DID_NOT_SETTLE_${status}`)
    }
    await new Promise((resolve) => { setTimeout(resolve, 25) })
    latest = await app.inject({
      method: 'GET',
      url: `/api/v1/cases/${caseId}/labor-allocation-ai/${runId}`,
      headers: { cookie },
    })
  }
}
