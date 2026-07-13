/**
 * File Agent yerel yapılandırması (Paket 14).
 *
 * MUTLAK root yolları YALNIZ burada (cihazın yerel config'inde) bulunur ve
 * API/DB/audit/log'a ASLA gönderilmez. Agent kimliği (id + secret) makine
 * kimlik bilgisidir; kullanıcı oturumundan ayrıdır. Gerçek config commit
 * EDİLMEZ; ortam değişkenlerinden veya güvenli yerel dosyadan yüklenir.
 */
export interface AgentConfig {
  readonly apiBaseUrl: string
  readonly agentId: string
  readonly agentSecret: string
  /** storageRootKey -> cihazdaki MUTLAK root yolu (yalnız yerel). */
  readonly roots: Readonly<Record<string, string>>
  readonly leaseSeconds: number
  /** Boş kuyrukta bir sonraki claim'e kadar bekleme (ms). */
  readonly pollIntervalMs: number
}

export class AgentConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentConfigError'
  }
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]
  if (value === undefined || value.trim().length === 0) {
    throw new AgentConfigError(`missing required env: ${key}`)
  }
  return value.trim()
}

/**
 * Ortamdan yükler. `HASARBOTU_AGENT_ROOTS` JSON'dur:
 * `{"baran-global-primary": "P:\\BARAN GLOBAL EKSPERTİZ"}`. Değerler yerel
 * mutlak yollardır ve dışarı sızdırılmaz.
 */
export function loadAgentConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const rootsRaw = required(env, 'HASARBOTU_AGENT_ROOTS')
  let roots: Record<string, string>
  try {
    const parsed: unknown = JSON.parse(rootsRaw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('roots must be an object')
    }
    roots = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== 'string' || value.length === 0) throw new Error(`invalid root path for ${key}`)
      roots[key] = value
    }
  } catch (error) {
    throw new AgentConfigError(`invalid HASARBOTU_AGENT_ROOTS: ${(error as Error).message}`)
  }

  const leaseSeconds = Number(env.HASARBOTU_AGENT_LEASE_SECONDS ?? '120')
  const pollIntervalMs = Number(env.HASARBOTU_AGENT_POLL_MS ?? '5000')
  return {
    apiBaseUrl: required(env, 'HASARBOTU_API_BASE_URL'),
    agentId: required(env, 'HASARBOTU_AGENT_ID'),
    agentSecret: required(env, 'HASARBOTU_AGENT_SECRET'),
    roots,
    leaseSeconds: Number.isFinite(leaseSeconds) && leaseSeconds > 0 ? leaseSeconds : 120,
    pollIntervalMs: Number.isFinite(pollIntervalMs) && pollIntervalMs > 0 ? pollIntervalMs : 5000,
  }
}
