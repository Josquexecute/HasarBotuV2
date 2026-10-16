import type pg from 'pg'
import { uuidv7 } from '@hasarbotu/database'
import type { RoleCode, PermissionCode } from '@hasarbotu/contracts'
import { allowedPermissions,loadRolePolicy } from './permissions.js'
import type { Queryable } from '../db/executor.js'

/**
 * Auth veri erisimi. Yalniz parametreli sorgular; ham parola asla saklanmaz,
 * oturum ham token'i asla saklanmaz (SHA-256 hash'i saklanir).
 */

export interface AuthUserRow {
  readonly id: string
  readonly organizationId: string
  readonly email: string
  readonly displayName: string
  readonly passwordHash: string | null
  readonly status: 'active' | 'disabled' | 'pending'
  readonly failedLoginCount: number
  readonly lockedUntil: Date | null
  readonly roles: readonly RoleCode[]
  readonly permissions?: readonly PermissionCode[]
}

export interface SessionRow {
  readonly user: AuthUserRow
  readonly expiresAt: Date
}

const USER_SELECT = `
  SELECT u.id, u.organization_id, u.email, u.display_name, u.password_hash,
         u.status, u.failed_login_count, u.locked_until,
         coalesce(array_agg(r.code ORDER BY r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles
  FROM users u
  LEFT JOIN user_roles ur ON ur.user_id = u.id
  LEFT JOIN roles r ON r.id = ur.role_id
`

interface RawUserRow {
  id: string
  organization_id: string
  email: string
  display_name: string
  password_hash: string | null
  status: 'active' | 'disabled' | 'pending'
  failed_login_count: number
  locked_until: Date | null
  roles: RoleCode[]
}

function mapUser(row: RawUserRow): AuthUserRow {
  return {
    id: row.id,
    organizationId: row.organization_id,
    email: row.email,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    status: row.status,
    failedLoginCount: row.failed_login_count,
    lockedUntil: row.locked_until,
    roles: row.roles,
  }
}

export function createAuthStore(pool: pg.Pool) {
  return {
    async findUserByEmail(email: string): Promise<AuthUserRow | undefined> {
      const result = await pool.query(
        `${USER_SELECT} WHERE lower(u.email) = lower($1) GROUP BY u.id`,
        [email],
      )
      const row = result.rows[0] as RawUserRow | undefined
      return row === undefined ? undefined : mapUser(row)
    },

    /** Serialize session creation with account, password, and lockout changes. */
    async lockUserForLogin(userId: string, exec: Queryable): Promise<AuthUserRow | undefined> {
      await exec.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId])
      const result = await exec.query(`${USER_SELECT} WHERE u.id=$1 GROUP BY u.id`, [userId])
      const row = result.rows[0] as RawUserRow | undefined
      return row === undefined ? undefined : mapUser(row)
    },

    /**
     * Basarisiz girisi sayar; esik asilirsa hesabi kilitler. Yeni sayaci
     * dondurur. `exec` verilirse (transaction istemcisi) UPDATE ile audit
     * kaydi ayni transaction'da atomik yazilabilir.
     */
    async recordFailedLogin(
      userId: string,
      maxFailures: number,
      lockMinutes: number,
      exec: Queryable = pool,
    ): Promise<{ failedLoginCount: number; lockedUntil: Date | null; lockStarted: boolean }> {
      const result = await exec.query(
        `WITH previous AS (
           SELECT id, failed_login_count, locked_until,
                  coalesce(locked_until > now(), false) AS lock_active,
                  locked_until IS NOT NULL AND locked_until <= now() AS lock_expired
           FROM users WHERE id=$1 FOR UPDATE
         )
         UPDATE users u
         SET failed_login_count = CASE WHEN p.lock_active THEN p.failed_login_count
                                       WHEN p.lock_expired THEN 1
                                       ELSE p.failed_login_count + 1 END,
             locked_until = CASE WHEN p.lock_active THEN p.locked_until
                                 WHEN p.lock_expired THEN NULL
                                 WHEN p.failed_login_count + 1 >= $2 THEN now() + make_interval(mins => $3)
                                 ELSE p.locked_until END,
             updated_at = now()
         FROM previous p WHERE u.id=p.id
         RETURNING u.failed_login_count, u.locked_until,
                   (NOT p.lock_active AND NOT p.lock_expired AND p.failed_login_count + 1 >= $2) AS lock_started`,
        [userId, maxFailures, lockMinutes],
      )
      const row = result.rows[0] as { failed_login_count: number; locked_until: Date | null; lock_started: boolean }
      return { failedLoginCount: row.failed_login_count, lockedUntil: row.locked_until, lockStarted: row.lock_started }
    },

    async resetFailedLogins(userId: string, exec: Queryable = pool): Promise<void> {
      await exec.query(
        'UPDATE users SET failed_login_count = 0, locked_until = NULL, updated_at = now() WHERE id = $1',
        [userId],
      )
    },

    async createSession(
      input: { tokenHash: string; userId: string; organizationId: string; expiresAt: Date },
      exec: Queryable = pool,
    ): Promise<void> {
      await exec.query(
        'INSERT INTO sessions (id, token_hash, user_id, organization_id, expires_at) VALUES ($1, $2, $3, $4, $5)',
        [uuidv7(), input.tokenHash, input.userId, input.organizationId, input.expiresAt],
      )
    },

    /** Aktif (suresi gecmemis, iptal edilmemis) oturumu aktif kullaniciyla dondurur. */
    async findActiveSession(tokenHash: string, exec: Queryable = pool): Promise<SessionRow | undefined> {
      const result = await exec.query(
        `SELECT s.expires_at AS session_expires_at,
                u.id, u.organization_id, u.email, u.display_name, u.password_hash,
                u.status, u.failed_login_count, u.locked_until,
                coalesce(array_agg(r.code ORDER BY r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN user_roles ur ON ur.user_id = u.id
         LEFT JOIN roles r ON r.id = ur.role_id
         WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
           AND u.status = 'active'
         GROUP BY s.id, u.id`,
        [tokenHash],
      )
      const row = result.rows[0] as (RawUserRow & { session_expires_at: Date }) | undefined
      if (row === undefined) return undefined
      const user = mapUser(row)
      return { user: { ...user,permissions: allowedPermissions(await loadRolePolicy(exec,user.organizationId),user.roles) }, expiresAt: row.session_expires_at }
    },

    /** Arşivlenmiş kayıtlar günlük vaka uçlarından erişilemez; tarihçe korunur. */
    async isCaseArchived(organizationId: string, caseId: string): Promise<boolean> {
      const result = await pool.query(
        'SELECT 1 FROM cases WHERE organization_id=$1 AND id::text=$2 AND is_archived=true',
        [organizationId, caseId],
      )
      return result.rowCount === 1
    },

    /** Oturumu iptal eder; zaten iptal edilmisse etkisizdir (idempotent). */
    async revokeSession(tokenHash: string, exec: Queryable = pool): Promise<boolean> {
      const result = await exec.query(
        'UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL',
        [tokenHash],
      )
      return (result.rowCount ?? 0) > 0
    },
  }
}

export type AuthStore = ReturnType<typeof createAuthStore>
