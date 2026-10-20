import { PERMISSION_DEFINITIONS, rolePolicySchema, type PermissionCode, type RolePolicy } from '@hasarbotu/contracts'
import type { Queryable } from '../db/executor.js'

export const defaultRolePolicy = (): RolePolicy => rolePolicySchema.parse({ version: 0,permissions: Object.fromEntries(PERMISSION_DEFINITIONS.map((item) => [item.code,item.roles])) })
export async function loadRolePolicy(exec: Queryable,organizationId: string): Promise<RolePolicy> {
  const row = (await exec.query('SELECT version,permissions FROM organization_role_policies WHERE organization_id=$1',[organizationId])).rows[0]
  return row ? rolePolicySchema.parse(row) : defaultRolePolicy()
}
export const allowedPermissions = (policy: RolePolicy,roles: readonly string[]): PermissionCode[] =>
  PERMISSION_DEFINITIONS.filter((item) => roles.some((role) => (policy.permissions[item.code] as readonly string[]).includes(role))).map((item) => item.code)
export const hasPermission = (user: { roles: readonly string[];permissions?: readonly PermissionCode[] },permission: PermissionCode) =>
  (user.permissions ?? allowedPermissions(defaultRolePolicy(),user.roles)).includes(permission)

/** Uses registered route templates, never raw URLs containing tokens or user input. */
export function permissionForRequest(route: string,method: string): PermissionCode | undefined {
  // Personal profile, appearance and notifications are self-service for every account.
  if (route === '/api/v1/me/assistant-appearance' || route === '/api/v1/me/profile' || route === '/api/v1/me/notification-preferences') return undefined
  if (method === 'GET' && (route === '/api/v1/desktop-updates/latest' || route === '/api/v1/desktop-updates/artifacts/:sha256')) return undefined
  if (!route.startsWith('/api/v1/') || /\/auth\/|\/google\//.test(route)) return undefined
  if (route.startsWith('/api/v1/field/')) return ['GET','HEAD'].includes(method) ? 'case_read' : 'documents_write'
  if (/\/audit-events/.test(route)) return 'audit_read'
  if (/^\/api\/v1\/users(?:\/|$)/.test(route)) return 'users_admin'
  if (/\/administration\//.test(route)) return method === 'GET' ? undefined : 'office_admin'
  if (/\/agents(?:\/|$)/.test(route)) return 'agents_admin'
  if (/\/v1-import/.test(route)) return 'office_admin'
  if (route === '/api/v1/legislation/ai-settings' && method === 'PUT') return 'office_admin'
  if (route.startsWith('/api/v1/legislation/')) return 'case_read'
  if (['GET','HEAD','OPTIONS'].includes(method)) {
    if (/\/fee(?:\/|$)|^\/api\/v1\/fees(?:\/|$)/.test(route)) return 'financial_read'
    return 'case_read'
  }
  if (/\/tracking\/notifications\//.test(route)) return 'case_read'
  if (/\/tracking\//.test(route)) return 'tracking_write'
  if (/\/email-drafts\/preview$/.test(route)) return 'case_read'
  if (/\/lifecycle(?:[-/])/.test(route)) return 'lifecycle_write'
  if (/\/file-operations\/|\/location$|\/workspace/.test(route)) return 'folders_write'
  if (/\/fees\/[^/]+\/(approve|correct)$/.test(route)) return 'fees_approve'
  if (/\/fee(?:\/|$)/.test(route)) return 'fees_write'
  if (/\/(notes|tasks|follow-up)(?:\/|$)/.test(route)) return 'operations_write'
  if (/\/(documents|photos)(?:\/|$)/.test(route)) return 'documents_write'
  if (/\/(policy-|traffic-value-loss|value-loss|pert|email-)/.test(route)) return /\/(approve|reject|resolve)$/.test(route) ? 'analysis_approve' : 'analysis_write'
  return 'case_write'
}
