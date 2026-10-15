import { z } from 'zod'
import { CANONICAL_DOCUMENT_TYPES, SERVICE_TYPES } from '@hasarbotu/domain'
import { roleCodeSchema } from './auth/index.js'
import { PERMISSION_CODES } from '../common/permissions.js'
export { PERMISSION_CODES } from '../common/permissions.js'

export const serviceEditSchema = z.strictObject({ name: z.string().trim().min(1).max(200),serviceType: z.enum(SERVICE_TYPES),phone: z.string().trim().max(50).nullable(),isActive: z.boolean() })
export const managedServiceSchema = serviceEditSchema.extend({ id: z.string().uuid(),version: z.number().int().positive() })
export const managedServicesSchema = z.strictObject({ items: z.array(managedServiceSchema) })
export const insurerEditSchema = z.strictObject({ name: z.string().trim().min(1).max(200),isActive: z.boolean() })
export const managedInsurerSchema = insurerEditSchema.extend({ id: z.string().uuid(),version: z.number().int().positive() })
export const managedInsurersSchema = z.strictObject({ items: z.array(managedInsurerSchema) })
export const documentRuleConfigurationSchema = z.strictObject({
  baseRequired: z.array(z.enum(CANONICAL_DOCUMENT_TYPES)).max(CANONICAL_DOCUMENT_TYPES.length)
    .refine((types) => new Set(types).size === types.length && types.every((type) => !['accident_report','ktt','statement','tramer_result','opposing_vehicle_registration','opposing_driver_license','opposing_traffic_policy','fault_ratio'].includes(type)), 'invalid_base_documents'),
  incidentEvidenceRequired: z.boolean(),tramerWithoutReportRequired: z.boolean(),recourseDocumentsRequired: z.boolean(),
})
export const managedDocumentRuleSchema = z.strictObject({ caseType: z.enum(['traffic','casco']),versionId: z.string().uuid(),configuration: documentRuleConfigurationSchema })
export const managedDocumentRulesSchema = z.strictObject({ items: z.array(managedDocumentRuleSchema) })

const OPERATORS = ['admin','expert','case_manager','secretary'] as const
const SPECIALISTS = ['admin','expert','case_manager'] as const
export const PERMISSION_DEFINITIONS = [
  { code: 'case_read',label: 'Dosya görüntüleme',roles: ['admin','expert','case_manager','secretary','accounting','read_only'] },
  { code: 'case_write',label: 'Dosya oluşturma ve güncelleme',roles: [...OPERATORS,'accounting'] },
  { code: 'operations_write',label: 'Not ve görev',roles: OPERATORS },
  { code: 'documents_write',label: 'Evrak ve fotoğraf',roles: OPERATORS },
  { code: 'lifecycle_write',label: 'Kapatma ve yeniden açma',roles: SPECIALISTS },
  { code: 'folders_write',label: 'Klasör işlemleri',roles: SPECIALISTS },
  { code: 'analysis_write',label: 'Analiz düzenleme',roles: SPECIALISTS },
  { code: 'analysis_approve',label: 'Analiz onayı',roles: ['admin','expert'] },
  { code: 'fees_write',label: 'Ücret adayı oluşturma',roles: SPECIALISTS },
  { code: 'fees_approve',label: 'Ücret onayı ve düzeltme',roles: ['admin','expert','accounting'] },
  { code: 'financial_read',label: 'Mali tutar görüntüleme',roles: [...SPECIALISTS,'accounting'] },
  { code: 'inventory_export',label: 'Telefon dışa aktarımı',roles: SPECIALISTS },
  { code: 'tracking_write',label: 'Evrak ve Tramer takibi',roles: OPERATORS },
  { code: 'audit_read',label: 'İşlem kayıtları',roles: ['admin'] },
  { code: 'users_admin',label: 'Kullanıcı ve rol yönetimi',roles: ['admin'] },
  { code: 'agents_admin',label: 'Dosya takip ajanı yönetimi',roles: ['admin'] },
  { code: 'office_admin',label: 'Servis ve ofis kuralı yönetimi',roles: ['admin'] },
] as const
export const permissionMapSchema = z.record(z.enum(PERMISSION_CODES),z.array(roleCodeSchema).max(6)).refine((value) =>
  PERMISSION_DEFINITIONS.every((definition) => value[definition.code].includes('admin') && new Set(value[definition.code]).size === value[definition.code].length &&
    value[definition.code].every((role) => (definition.roles as readonly string[]).includes(role))), 'invalid_permission_roles')
export const rolePolicySchema = z.strictObject({ version: z.number().int().nonnegative(),permissions: permissionMapSchema })
export type PermissionCode = typeof PERMISSION_CODES[number]
export type RolePolicy = z.infer<typeof rolePolicySchema>
export type DocumentRuleConfiguration = z.infer<typeof documentRuleConfigurationSchema>
