import type pg from 'pg'
import { userSummarySchema, type RoleCode, type UserSummary } from '@hasarbotu/contracts'
import { createAuditService } from '../audit/service.js'

interface ActorContext {
  readonly organizationId: string
  readonly actorUserId: string
  readonly requestId: string
}

interface UserRow {
  id: string
  email: string
  display_name: string
  status: 'active' | 'disabled'
  version: number
  roles: (RoleCode | null)[]
}

export type UpdateRolesOutcome =
  | { kind: 'not_found' }
  | { kind: 'version_conflict' }
  | { kind: 'self_lockout' }
  | { kind: 'ok'; user: UserSummary }

function rowToSummary(row: UserRow): UserSummary {
  return userSummarySchema.parse({
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    status: row.status,
    roles: [...new Set(row.roles.filter((role): role is RoleCode => role !== null))].sort(),
    version: row.version,
  })
}

/**
 * Kullanıcı/rol yönetimi (HB-011): yalnız `admin` erişebilir. Rol ataması
 * `users.version` ile optimistic lock'lu, `user_roles` üzerinde tam
 * değiştirme (silme + yeniden ekleme) ile atomik uygulanır. Kendi kendini
 * kilitleme (aktif admin kendi admin rolünü kaldırırsa) reddedilir.
 */
export function createUsersStore(pool: pg.Pool) {
  const audit = createAuditService()
  return {
    async list(organizationId: string): Promise<UserSummary[]> {
      const result = await pool.query(
        `SELECT u.id::text,u.email,u.display_name,u.status,u.version,
                array_agg(r.code ORDER BY r.code) FILTER (WHERE r.code IS NOT NULL) AS roles
           FROM users u
           LEFT JOIN user_roles ur ON ur.user_id=u.id
           LEFT JOIN roles r ON r.id=ur.role_id
          WHERE u.organization_id=$1
          GROUP BY u.id
          ORDER BY u.display_name`,
        [organizationId],
      )
      return (result.rows as UserRow[]).map(rowToSummary)
    },

    async updateRoles(
      actor: ActorContext,
      targetUserId: string,
      input: { roles: readonly RoleCode[]; expectedVersion: number },
    ): Promise<UpdateRolesOutcome> {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        // `FOR UPDATE`, GROUP BY/agregat ile birlikte kullanılamaz (PostgreSQL
        // kısıtı); satır kilidi düz SELECT ile, roller AYRI bir sorguyla okunur.
        const lock = await client.query(
          `SELECT id::text,email,display_name,status,version
             FROM users WHERE id=$1 AND organization_id=$2
             FOR UPDATE`,
          [targetUserId, actor.organizationId],
        )
        const lockedRow = lock.rows[0] as Omit<UserRow, 'roles'> | undefined
        if (lockedRow === undefined) {
          await client.query('ROLLBACK')
          return { kind: 'not_found' }
        }
        if (lockedRow.version !== input.expectedVersion) {
          await client.query('ROLLBACK')
          return { kind: 'version_conflict' }
        }
        const rolesResult = await client.query(
          'SELECT r.code FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=$1',
          [targetUserId],
        )
        const existing: UserRow = { ...lockedRow, roles: (rolesResult.rows as { code: RoleCode }[]).map((row) => row.code) }
        const previousRoles = [...new Set(existing.roles.filter((role): role is RoleCode => role !== null))]
        const newRoles = [...new Set(input.roles)]
        const isSelf = targetUserId === actor.actorUserId
        if (isSelf && previousRoles.includes('admin') && !newRoles.includes('admin')) {
          await client.query('ROLLBACK')
          return { kind: 'self_lockout' }
        }

        const updated = await client.query(
          `UPDATE users SET version=version+1, updated_at=now()
            WHERE id=$1 AND organization_id=$2
          RETURNING version`,
          [targetUserId, actor.organizationId],
        )
        const nextVersion = (updated.rows[0] as { version: number }).version
        await client.query('DELETE FROM user_roles WHERE user_id=$1', [targetUserId])
        if (newRoles.length > 0) {
          const inserted = await client.query(
            'INSERT INTO user_roles (user_id,role_id) SELECT $1::uuid,id FROM roles WHERE code=ANY($2::text[])',
            [targetUserId, newRoles],
          )
          // Sözleşme enum'u (`ROLE_CODES`) ile `roles` tablosu ayrışırsa bu
          // INSERT SESSİZCE daha az satır yazar ve yanıt, GERÇEKTE verilmemiş
          // bir yetkiyi verilmiş gibi bildirirdi. Eksik eşleşmede işlem geri
          // alınır; yetki durumu hakkında yanlış bilgi döndürülmez.
          // (Geri alma aşağıdaki `catch` bloğunda yapılır.)
          if ((inserted.rowCount ?? 0) !== newRoles.length) {
            throw new Error(
              `role code mismatch: requested ${newRoles.length}, matched ${inserted.rowCount ?? 0}`,
            )
          }
        }
        await audit.record(client, {
          organizationId: actor.organizationId,
          actorUserId: actor.actorUserId,
          requestId: actor.requestId,
          action: 'user.roles_changed',
          entityType: 'user',
          entityId: targetUserId,
          details: { previousRoles, newRoles, fromVersion: existing.version, toVersion: nextVersion },
        })
        await client.query('COMMIT')
        return {
          kind: 'ok',
          user: rowToSummary({
            id: existing.id,
            email: existing.email,
            display_name: existing.display_name,
            status: existing.status,
            version: nextVersion,
            roles: newRoles,
          }),
        }
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
      } finally {
        client.release()
      }
    },
  }
}

export type UsersStore = ReturnType<typeof createUsersStore>
