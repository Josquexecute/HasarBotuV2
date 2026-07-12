import type pg from 'pg'
import { uuidv7 } from '@hasarbotu/database'
import type { RoleCode } from '@hasarbotu/contracts'

/**
 * Auth veri erisimi. Yalniz parametreli sorgular; ham parola asla saklanmaz,
 * oturum ham token'i asla saklanmaz (SHA-256 hash'i saklanir).
 */

export interface AuthUserRow {
  readonly id: string
  readonly organizationId: string
  readonly email: string
  readonly displayName: string
  readonly passwordHash: string
  readonly status: 'active' | 'disabled'
  readonly failedLoginCount: number
  readonly lockedUntil: Date | null
  readonly roles: readonly RoleCode[]
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
  password_hash: string
  status: 'active' | 'disabled'
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

    /** Basarisiz girisi sayar; esik asilirsa hesabi kilitler. Yeni sayaci dondurur. */
    async recordFailedLogin(
      userId: string,
      maxFailures: number,
      lockMinutes: number,
    ): Promise<{ failedLoginCount: number; lockedUntil: Date | null }> {
      const result = await pool.query(
        `UPDATE users
         SET failed_login_count = failed_login_count + 1,
             locked_until = CASE WHEN failed_login_count + 1 >= $2
                                 THEN now() + make_interval(mins => $3)
                                 ELSE locked_until END,
             updated_at = now()
         WHERE id = $1
         RETURNING failed_login_count, locked_until`,
        [userId, maxFailures, lockMinutes],
      )
      const row = result.rows[0] as { failed_login_count: number; locked_until: Date | null }
      return { failedLoginCount: row.failed_login_count, lockedUntil: row.locked_until }
    },

    async resetFailedLogins(userId: string): Promise<void> {
      await pool.query(
        'UPDATE users SET failed_login_count = 0, locked_until = NULL, updated_at = now() WHERE id = $1',
        [userId],
      )
    },

    async createSession(input: {
      tokenHash: string
      userId: string
      organizationId: string
      expiresAt: Date
    }): Promise<void> {
      await pool.query(
        'INSERT INTO sessions (id, token_hash, user_id, organization_id, expires_at) VALUES ($1, $2, $3, $4, $5)',
        [uuidv7(), input.tokenHash, input.userId, input.organizationId, input.expiresAt],
      )
    },

    /** Aktif (suresi gecmemis, iptal edilmemis) oturumu aktif kullaniciyla dondurur. */
    async findActiveSession(tokenHash: string): Promise<SessionRow | undefined> {
      const result = await pool.query(
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
      return { user: mapUser(row), expiresAt: row.session_expires_at }
    },

    /** Oturumu iptal eder; zaten iptal edilmisse etkisizdir (idempotent). */
    async revokeSession(tokenHash: string): Promise<boolean> {
      const result = await pool.query(
        'UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL',
        [tokenHash],
      )
      return (result.rowCount ?? 0) > 0
    },

    /** Append-only audit kaydi; details icine ham parola/token/e-posta yazilmaz. */
    async insertAudit(event: {
      organizationId?: string
      actorUserId?: string
      action: string
      requestId?: string
      details?: Readonly<Record<string, string | number | boolean>>
    }): Promise<void> {
      await pool.query(
        `INSERT INTO audit_events (id, organization_id, actor_user_id, action, request_id, details)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [
          uuidv7(),
          event.organizationId ?? null,
          event.actorUserId ?? null,
          event.action,
          event.requestId ?? null,
          JSON.stringify(event.details ?? {}),
        ],
      )
    },
  }
}

export type AuthStore = ReturnType<typeof createAuthStore>
