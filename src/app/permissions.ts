import type { PermissionCode } from '@hasarbotu/contracts'
import type { SessionUser } from '../data/authPort'

export function canUsePermission(user: SessionUser | null,permission: PermissionCode,fallbackRoles: readonly string[]): boolean {
  if (!user) return false
  return user.permissions ? user.permissions.includes(permission) : user.roles.some((role) => fallbackRoles.includes(role))
}
