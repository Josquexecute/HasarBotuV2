import type pg from 'pg'
import { z } from 'zod'
import { createGoogleProvider, decryptToken, GoogleProviderError, type GoogleConfig, type GoogleProvider } from './google.js'
import { gmailMessageSchema, parseSbmMessage } from './sbm.js'
import { ingestSbmResult } from './store.js'

/** Full sender-filtered reconciliation avoids expiring Gmail history cursors. Receipts are durable. */
export async function syncMailboxes(pool: pg.Pool, config: GoogleConfig, provider: GoogleProvider = createGoogleProvider(config), signal?: AbortSignal): Promise<void> {
  if (!config.sbmSenders.length) return
  const connections = await pool.query("SELECT * FROM mail_connections WHERE status IN ('connected','error') AND encrypted_refresh_token IS NOT NULL ORDER BY id")
  for (const c of connections.rows) {
    if (signal?.aborted) return
    // Advisory locks serialize mailbox workers across API replicas, and release on process death.
    const lock = await pool.connect()
    let locked = false
    try {
      locked = (await lock.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired', [`mail:${c.id}`])).rows[0].acquired === true
      if (!locked) continue
      const token = decryptToken(c.encrypted_refresh_token,config.encryptionKey,`${c.organization_id}:${c.subject}`)
      const refreshed = await provider.refresh(token)
      let page: string | undefined
      const seenPages = new Set<string>()
      do {
        if (signal?.aborted) return
        const q = `{${config.sbmSenders.map((s) => `from:${s}`).join(' ')}}`
        const params = new URLSearchParams({ q,maxResults: '100',includeSpamTrash: 'true',...(page ? { pageToken: page } : {}) })
        const list = z.object({ messages: z.array(z.object({ id: z.string() })).optional(),nextPageToken: z.string().optional() }).parse(await provider.gmail(refreshed.access_token,`messages?${params}`))
        const ids = (list.messages ?? []).map((m) => m.id)
        const existing = await pool.query('SELECT provider_message_id FROM sbm_messages WHERE connection_id=$1 AND provider_message_id=ANY($2::text[])', [c.id,ids])
        const known = new Set(existing.rows.map((r) => r.provider_message_id))
        for (const id of ids) {
          if (signal?.aborted) return
          if (known.has(id)) continue
          const message = gmailMessageSchema.parse(await provider.gmail(refreshed.access_token,`messages/${encodeURIComponent(id)}?format=full`))
          const receivedAt = new Date(Number(message.internalDate))
          if (!Number.isFinite(receivedAt.getTime())) throw new Error('Invalid message date')
          await ingestSbmResult(pool,{ connectionId: c.id,messageId: message.id,receivedAt,result: parseSbmMessage(message,config.sbmSenders),automatic: config.automaticSbmEnabled })
        }
        page = list.nextPageToken
        if (page && seenPages.has(page)) throw new Error('Repeated Gmail page')
        if (page) seenPages.add(page)
      } while (page)
      await pool.query("UPDATE mail_connections SET status='connected',last_success_at=now(),last_error=NULL WHERE id=$1 AND encrypted_refresh_token=$2 AND status <> 'disconnected'", [c.id,c.encrypted_refresh_token])
      await pool.query(`INSERT INTO tracking_health(organization_id,kind,source_id,last_success_at) VALUES($1,'mail',$2,now())
        ON CONFLICT(organization_id,kind,source_id) DO UPDATE SET last_attempt_at=now(),last_success_at=now(),error_code=NULL`, [c.organization_id,c.id])
    } catch (error) {
      const status = error instanceof GoogleProviderError && error.kind === 'permission_required' ? 'permission_required' : 'error'
      // Preserve the last successful scan and never overwrite a concurrent reconnect/disconnect.
      await pool.query('UPDATE mail_connections SET status=$2,last_error=$3 WHERE id=$1 AND encrypted_refresh_token=$4 AND status <> \'disconnected\'', [c.id,status,status === 'permission_required' ? 'Google izni yenilenmeli.' : 'E-posta takibi tamamlanamadı; yeniden denenecek.',c.encrypted_refresh_token])
      await pool.query(`INSERT INTO tracking_health(organization_id,kind,source_id,error_code) VALUES($1,'mail',$2,$3)
        ON CONFLICT(organization_id,kind,source_id) DO UPDATE SET last_attempt_at=now(),error_code=excluded.error_code`, [c.organization_id,c.id,status])
    } finally {
      try { if (locked) await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [`mail:${c.id}`]) }
      finally { lock.release() }
    }
  }
}

export function startMailWorker(pool: pg.Pool, config: GoogleConfig, onError: () => void) {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let running: Promise<void> = Promise.resolve()
  const cycle = () => {
    running = syncMailboxes(pool,config,undefined,controller.signal).catch(onError).finally(() => {
      if (!controller.signal.aborted) timer = setTimeout(cycle,60_000)
    })
  }
  cycle()
  return async () => { controller.abort(); if (timer) clearTimeout(timer); await running }
}
