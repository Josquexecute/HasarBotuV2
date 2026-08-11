import { z } from 'zod'

/**
 * V1 `_HASARBOTU/takip.json` semasi -- GERCEK production dosyalarindan
 * (2026-08-11, `C:\HasarBotuStorage\BARAN GLOBAL EKSPERTİZ`) dogrudan
 * okunarak cikarildi, TAHMIN EDILMEDI. Bugune kadar gozlenen TUM 142+
 * gercek dosya `schemaVersion:1`; baska surum hic gorulmedi ama kod
 * `parseV1TakipJson` icinde acikca dispatch eder -- yeni bir surum
 * gelirse sessizce yanlis yorumlanmaz, `unsupported_schema_version` doner.
 *
 * TOLERANSLI tasarim: gercek dosyalarin cogu alani bos string ("") tasiyor,
 * bazi objeler/diziler eksik olabilir. Zod semasi bu yuzden neredeyse her
 * yerde `.optional()`/varsayilan bos deger kullanir -- semaya uymayan bir
 * TEK alan yuzunden butun dosya reddedilmez (aksi halde gercek, faydali
 * verinin cogu "parse hatasi" olarak kaybolurdu). `.passthrough()` ile
 * bilinmeyen ek alanlar da atilmadan tasinir (raw_snapshot'ta korunur).
 */

const emptyableString = z.string().optional().default('')
const nullableEmptyableString = z.union([z.string(), z.null()]).optional().default('')

const v1CaseIdentitySchema = z.object({
  caseKey: emptyableString,
  plate: emptyableString,
  dosyaNo: emptyableString,
  officeFileNo: emptyableString,
  claimNoticeNo: emptyableString,
  folderPath: emptyableString,
  monthFolder: emptyableString,
  isClosedFolder: z.boolean().optional().default(false),
}).passthrough()

const v1MetadataSchema = z.object({
  createdAt: emptyableString,
  updatedAt: emptyableString,
  createdByComputer: emptyableString,
  updatedByComputer: emptyableString,
  revision: z.number().int().optional(),
  writeId: emptyableString,
}).passthrough()

const v1AssignmentSchema = z.object({
  sorumlu: emptyableString,
  eksper: emptyableString,
  raportor: emptyableString,
  takipTarihi: emptyableString,
  sonIslemTarihi: emptyableString,
  oncelik: emptyableString,
}).passthrough()

const v1StatusSchema = z.object({
  dosyaDurumu: emptyableString,
  workflowStatus: emptyableString,
  kapaliMi: z.boolean().optional().default(false),
}).passthrough()

const v1ServiceSchema = z.object({
  name: emptyableString,
  source: emptyableString,
  updatedAt: emptyableString,
  updatedBy: emptyableString,
}).passthrough().optional()

const v1PortalChecklistItemSchema = z.object({
  key: z.string(),
  label: emptyableString,
  completed: z.boolean().optional().default(false),
  completedBy: emptyableString,
  completedAt: emptyableString,
}).passthrough()

const v1TodoSchema = z.object({
  id: z.string(),
  title: emptyableString,
  completed: z.boolean().optional().default(false),
  priority: emptyableString,
  assignedTo: emptyableString,
  dueDate: emptyableString,
  createdAt: emptyableString,
  completedAt: emptyableString,
}).passthrough()

const v1NoteSchema = z.object({
  id: z.string(),
  createdAt: emptyableString,
  createdBy: emptyableString,
  text: emptyableString,
}).passthrough()

const v1AuditEntrySchema = z.object({
  at: emptyableString,
  by: emptyableString,
  computer: emptyableString,
  action: emptyableString,
  text: emptyableString,
}).passthrough()

const v1VehicleContextSchema = z.object({
  plate: emptyableString,
  chassisNo: emptyableString,
  engineNo: emptyableString,
  make: emptyableString,
  model: emptyableString,
  modelYear: emptyableString,
  fuelType: emptyableString,
  engineDisplacement: emptyableString,
  transmission: emptyableString,
  bodyType: emptyableString,
  damageDirection: emptyableString,
}).passthrough().optional()

/**
 * `schemaVersion:1` govdesi. `claimType` disinda hemen her alan V2'de
 * birinci-sinif bir kolona eslenmez -- store.ts yalniz kullandigi alanlari
 * ayiklar, TAM govde `raw_snapshot` olarak provenance kaydinda saklanir.
 */
export const v1TakipJsonV1Schema = z.object({
  schemaVersion: z.literal(1),
  caseIdentity: v1CaseIdentitySchema.optional(),
  metadata: v1MetadataSchema.optional(),
  assignment: v1AssignmentSchema.optional(),
  status: v1StatusSchema.optional(),
  claimType: nullableEmptyableString,
  service: v1ServiceSchema,
  portalChecklist: z.array(v1PortalChecklistItemSchema).optional().default([]),
  todos: z.array(v1TodoSchema).optional().default([]),
  notes: z.array(v1NoteSchema).optional().default([]),
  vehicleContext: v1VehicleContextSchema,
  audit: z.array(v1AuditEntrySchema).optional().default([]),
}).passthrough()

export type V1TakipJsonV1 = z.infer<typeof v1TakipJsonV1Schema>

export type V1TakipJsonParseResult =
  | { readonly ok: true; readonly schemaVersion: 1; readonly data: V1TakipJsonV1 }
  | { readonly ok: false; readonly reason: 'malformed_json' }
  | { readonly ok: false; readonly reason: 'missing_schema_version' }
  | { readonly ok: false; readonly reason: 'unsupported_schema_version'; readonly foundVersion: unknown }
  | { readonly ok: false; readonly reason: 'schema_validation_failed'; readonly issues: readonly string[] }

/**
 * Ham dosya metnini once JSON.parse eder (bozuksa `malformed_json`), sonra
 * `schemaVersion`e gore dispatch eder. Bugun yalniz 1 desteklenir; farkli
 * bir surum GORULMEDI diye sessizce 1 gibi yorumlanmaz -- acikca
 * `unsupported_schema_version` doner, cagiran taraf bunu control_required
 * olarak isaretlemelidir.
 */
export function parseV1TakipJson(rawText: string): V1TakipJsonParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(rawText)
  } catch {
    return { ok: false, reason: 'malformed_json' }
  }
  if (typeof raw !== 'object' || raw === null || !('schemaVersion' in raw)) {
    return { ok: false, reason: 'missing_schema_version' }
  }
  const version = (raw as Record<string, unknown>).schemaVersion
  if (version !== 1) {
    return { ok: false, reason: 'unsupported_schema_version', foundVersion: version }
  }
  const result = v1TakipJsonV1Schema.safeParse(raw)
  if (!result.success) {
    return {
      ok: false,
      reason: 'schema_validation_failed',
      issues: result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    }
  }
  return { ok: true, schemaVersion: 1, data: result.data }
}
