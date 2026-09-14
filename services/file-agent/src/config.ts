/**
 * File Agent yerel yapılandırması (Paket 14).
 *
 * MUTLAK root yolları YALNIZ burada (cihazın yerel config'inde) bulunur ve
 * API/DB/audit/log'a ASLA gönderilmez. Agent kimliği (id + secret) makine
 * kimlik bilgisidir; kullanıcı oturumundan ayrıdır. Gerçek config commit
 * EDİLMEZ; ortam değişkenlerinden veya güvenli yerel dosyadan yüklenir.
 */
/**
 * Session-0-safe per-case freshness gate yapılandırması (HB-2026-171,
 * HB-2026-167 Karar 1'in File Agent entegrasyonu). Tanımlıysa, kritik
 * (yazan) işlemlerden HEMEN ÖNCE `pcloud-session0-freshness-gate.mjs`
 * ayrı bir alt-süreç olarak çağrılır (P:\'ye hiçbir bağımlılığı yoktur,
 * yalnız node:* builtin'leri kullanır -- npm workspace/rootDir sınırları
 * dışında, bilerek spawn-friendly). Tanımlı DEĞİLSE, kritik işlemler
 * fail-closed reddedilir (`case_not_fresh`/`freshness_gate_not_configured`)
 * -- sessizce atlanmaz.
 */
export interface FreshnessGateConfig {
  /** deploy/windows-service/pcloud-session0-freshness-gate.mjs yolu. */
  readonly toolPath: string
  /** pCloud yerel SQLite DB'sinin MUTLAK yolu (data.db). */
  readonly pcloudLocalDatabasePath: string
  /** pCloud DB'nin klasör ağacındaki üst-düzey (şirket) klasör adı. */
  readonly topLevelFolderName: string
  /** Attestation kayıtlarının MUTLAK dizini. */
  readonly attestationStoreDirectory: string
}

export interface AgentConfig {
  readonly apiBaseUrl: string
  readonly agentId: string
  readonly agentSecret: string
  /** storageRootKey -> cihazdaki MUTLAK root yolu (yalnız yerel). */
  readonly roots: Readonly<Record<string, string>>
  readonly leaseSeconds: number
  /** Boş kuyrukta bir sonraki claim'e kadar bekleme (ms). */
  readonly pollIntervalMs: number
  /** Tanımsızsa kritik işlemler fail-closed reddedilir, sessizce atlanmaz. */
  readonly freshnessGate: FreshnessGateConfig | undefined
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
  } catch {
    // JSON.parse diagnostics can quote environment values, including local paths.
    throw new AgentConfigError('invalid HASARBOTU_AGENT_ROOTS: expected a JSON object with non-empty string paths')
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
    freshnessGate: loadFreshnessGateConfigFromEnv(env),
  }
}

/**
 * Dört değişkenin TÜMÜ verilmişse etkin bir yapılandırma döner. HİÇBİRİ
 * verilmemişse `undefined` döner (özellik henüz yapılandırılmamış --
 * kritik işlemler yine de fail-closed reddedilir, ama bu net bir
 * "yapılandırılmadı" durumu olarak, KISMEN yapılandırılmış (bazıları
 * verilmiş bazıları eksik) bir durumdan ayrı raporlanır). Kısmi
 * yapılandırma başlangıçta AgentConfigError fırlatır -- bir kritik işlem
 * ilk denendiğinde değil, servis başlarken hemen yakalanır.
 */
function loadFreshnessGateConfigFromEnv(env: NodeJS.ProcessEnv): FreshnessGateConfig | undefined {
  const keys = [
    'HASARBOTU_AGENT_FRESHNESS_GATE_TOOL_PATH',
    'HASARBOTU_AGENT_PCLOUD_DB_PATH',
    'HASARBOTU_AGENT_PCLOUD_TOP_LEVEL_FOLDER',
    'HASARBOTU_AGENT_ATTESTATION_STORE',
  ] as const
  const present = keys.filter((key) => env[key] !== undefined && env[key]!.trim().length > 0)
  if (present.length === 0) return undefined
  if (present.length !== keys.length) {
    const missing = keys.filter((key) => !present.includes(key))
    throw new AgentConfigError(`partial freshness gate config -- missing: ${missing.join(', ')}`)
  }
  return {
    toolPath: required(env, 'HASARBOTU_AGENT_FRESHNESS_GATE_TOOL_PATH'),
    pcloudLocalDatabasePath: required(env, 'HASARBOTU_AGENT_PCLOUD_DB_PATH'),
    topLevelFolderName: required(env, 'HASARBOTU_AGENT_PCLOUD_TOP_LEVEL_FOLDER'),
    attestationStoreDirectory: required(env, 'HASARBOTU_AGENT_ATTESTATION_STORE'),
  }
}
