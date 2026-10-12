import { describe,expect,it } from 'vitest'
import { defaultRolePolicy,allowedPermissions,permissionForRequest } from '../src/auth/permissions.js'
describe('route authorization boundaries',() => {
  it.each([
    ['/api/v1/references/users','GET','case_read'],
    ['/api/v1/users','GET','users_admin'],
    ['/api/v1/users/:userId/roles','PATCH','users_admin'],
    ['/api/v1/cases/:caseId/email-drafts/preview','POST','case_read'],
    ['/api/v1/cases/:caseId/policy-ai-runs/:runId/promote','POST','analysis_write'],
    ['/api/v1/cases/:caseId/policy-analyses/:analysisId/approve','POST','analysis_approve'],
    ['/api/v1/fees/:feeId/approve','POST','fees_approve'],
    ['/api/v1/tracking/notifications/dismiss','POST','case_read'],
  ])('maps %s %s to the intended permission',(route,method,permission) => {
    expect(permissionForRequest(route,method)).toBe(permission)
  })
  it('keeps a reader out of business changes and supports additive assigned roles',() => {
    expect(allowedPermissions(defaultRolePolicy(),['read_only'])).toEqual(['case_read'])
    expect(allowedPermissions(defaultRolePolicy(),['case_manager','accounting'])).toContain('fees_approve')
    expect(allowedPermissions(defaultRolePolicy(),[])).toEqual([])
  })
})
