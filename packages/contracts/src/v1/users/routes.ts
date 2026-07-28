import { API_V1_BASE } from '../../common/routes.js'

export const USERS_ROUTE = `${API_V1_BASE}/users` as const
export const USER_ROLES_ROUTE = `${API_V1_BASE}/users/:userId/roles` as const
