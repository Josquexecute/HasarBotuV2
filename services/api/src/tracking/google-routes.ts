import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import { z } from 'zod'
import { uuidv7 } from '@hasarbotu/database'
import { createAuthStore } from '../auth/store.js'
import { requireSession } from '../auth/guard.js'
import { buildSessionCookie, parseCookies } from '../auth/cookies.js'
import { generateSessionToken, hashSessionToken } from '../auth/token.js'
import { SESSION_TTL_SECONDS } from '../auth/service.js'
import { createFixedWindowLimiter } from '../auth/rate-limit.js'
import { withTransaction } from '../db/executor.js'
import { createAuditService } from '../audit/service.js'
import { canManageTracking } from './store.js'
import { createGoogleProvider, digest, encryptToken, GMAIL_SCOPE, randomToken, type GoogleConfig, type GoogleProvider } from './google.js'

const COOKIE = 'hb_google_flow'
export function registerGoogleRoutes(app: FastifyInstance, options: { pool: pg.Pool; cookieSecure: boolean; config?: GoogleConfig; provider?: GoogleProvider }) {
  const { pool,config } = options
  const auth = createAuthStore(pool)
  const provider = options.provider ?? (config ? createGoogleProvider(config) : undefined)
  const limiter = createFixedWindowLimiter({ limit: 10,windowMs: 60_000 })
  const audit = createAuditService()
  app.get('/api/v1/google/status',async () => ({ enabled: config !== undefined }))
  app.post('/api/v1/google/start',async (request,reply) => {
    if (!config || !provider) return reply.code(503).send({ error: 'Google bağlantısı yapılandırılmamış.' })
    if (!limiter.consume(request.ip).allowed) return reply.code(429).send({ error: 'Çok fazla giriş denemesi.' })
    const parsed = z.object({ purpose: z.enum(['login','mail']) }).strict().safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Geçersiz giriş amacı.' })
    let userId: string | null = null
    if (parsed.data.purpose === 'mail') {
      const session = await requireSession(auth,request,reply)
      if (!session) return
      if (!canManageTracking(session)) return reply.code(403).send({ error: 'E-posta bağlantısı yönetim yetkisi gereklidir.' })
      if (config.sbmSenders.length === 0) return reply.code(409).send({ error: 'SBM gönderen adresleri sunucuda henüz tanımlanmamış.' })
      userId = session.user.id
    }
    const state = randomToken(), browser = randomToken(), nonce = randomToken(), verifier = randomToken()
    await withTransaction(pool,async (db) => {
      await db.query('DELETE FROM google_oauth_states WHERE expires_at < now()')
      await db.query(`INSERT INTO google_oauth_states(state_hash,browser_hash,purpose,user_id,nonce,verifier,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,now()+interval '10 minutes')`, [digest(state),digest(browser),parsed.data.purpose,userId,nonce,verifier])
    })
    void reply.header('cache-control','no-store')
    void reply.header('set-cookie',`${COOKIE}=${browser}; HttpOnly; SameSite=Strict; Path=/; Max-Age=600${options.cookieSecure ? '; Secure' : ''}`)
    return { flowId: state, url: provider.authorizeUrl(parsed.data.purpose,state,nonce,verifier) }
  })
  // OAuth codes never enter access logs. The external browser receives no application session.
  app.get('/api/v1/google/callback',{ logLevel: 'silent' },async (request,reply) => {
    void reply.header('cache-control','no-store').header('referrer-policy','no-referrer').header('content-security-policy',"default-src 'none'; frame-ancestors 'none'")
    if (!config || !provider) return reply.code(503).type('text/plain; charset=utf-8').send('Google bağlantısı yapılandırılmamış.')
    const query = z.object({ state: z.string().min(20).max(200),code: z.string().max(4000).optional(),error: z.string().max(200).optional() }).safeParse(request.query)
    if (!query.success) return reply.code(400).send('Geçersiz Google yanıtı.')
    const row = (await pool.query(`UPDATE google_oauth_states SET claimed_at=now() WHERE state_hash=$1 AND claimed_at IS NULL AND expires_at>now() RETURNING *`, [digest(query.data.state)])).rows[0]
    if (!row) return reply.code(400).send('Giriş isteği süresi dolmuş veya zaten kullanılmış.')
    try {
      if (query.data.error || !query.data.code) throw new Error('Consent denied')
      const tokens = await provider.exchange(query.data.code,row.verifier)
      if (!tokens.id_token) throw new Error('Missing identity token')
      const identity = await provider.identity(tokens.id_token,row.nonce,row.purpose === 'login')
      await withTransaction(pool,async (db) => {
        if (row.purpose === 'login') {
          const user = (await db.query("SELECT * FROM users WHERE lower(email)=lower($1) AND status='active' FOR UPDATE", [identity.email])).rows[0]
          if (!user) throw new Error('Employee not registered')
          await db.query('INSERT INTO google_identities(subject,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [identity.sub,user.id])
          const linked = (await db.query('SELECT user_id FROM google_identities WHERE subject=$1', [identity.sub])).rows[0]
          if (linked?.user_id !== user.id) throw new Error('Identity conflict')
          await db.query('UPDATE google_oauth_states SET completed_user_id=$2,completed_at=now(),verifier=\'\' WHERE state_hash=$1', [row.state_hash,user.id])
        } else {
          const operator = await auth.findUserByEmail((await db.query('SELECT email FROM users WHERE id=$1', [row.user_id])).rows[0]?.email ?? '')
          if (!operator || operator.status !== 'active' || !operator.roles.some((r) => ['admin','expert','case_manager'].includes(r))) throw new Error('Operator no longer authorized')
          if (!tokens.scope?.split(' ').includes(GMAIL_SCOPE) || !tokens.refresh_token) throw new Error('Offline mail permission required')
          const profile = z.object({ emailAddress: z.string() }).parse(await provider.gmail(tokens.access_token,'profile'))
          if (profile.emailAddress.toLowerCase() !== identity.email.toLowerCase()) throw new Error('Mailbox identity mismatch')
          const encrypted = encryptToken(tokens.refresh_token,config.encryptionKey,`${operator.organizationId}:${identity.sub}`)
          const connection = (await db.query(`INSERT INTO mail_connections(id,organization_id,connected_by,subject,email,encrypted_refresh_token,status)
            VALUES($1,$2,$3,$4,$5,$6,'connected') ON CONFLICT(organization_id,subject) DO UPDATE
            SET connected_by=excluded.connected_by,email=excluded.email,encrypted_refresh_token=excluded.encrypted_refresh_token,status='connected',last_error=NULL,updated_at=now()
            RETURNING id`, [uuidv7(),operator.organizationId,operator.id,identity.sub,identity.email,encrypted])).rows[0]
          await audit.record(db,{ organizationId: operator.organizationId,actorUserId: operator.id,action: 'tracking.mail_connected',entityType: 'mail_connection',entityId: connection.id,details: { sourceAccount: identity.email } })
          await db.query("UPDATE google_oauth_states SET completed_at=now(),verifier='' WHERE state_hash=$1", [row.state_hash])
        }
      })
      return reply.type('text/plain; charset=utf-8').send('Google bağlantısı tamamlandı. HasarBotu uygulamasına dönebilirsiniz.')
    } catch {
      app.log.warn({ category: 'google_authorization_failed' },'Google authorization did not complete; no session issued')
      await pool.query("UPDATE google_oauth_states SET error_code='authorization_failed',verifier='' WHERE state_hash=$1", [row.state_hash])
      return reply.code(400).type('text/plain; charset=utf-8').send('Google bağlantısı kurulamadı. Hesap, çalışan kaydı ve izinleri kontrol edip uygulamadan yeniden deneyin.')
    }
  })
  app.post('/api/v1/google/complete',async (request,reply) => {
    void reply.header('cache-control','no-store')
    const body = z.object({ flowId: z.string().min(20).max(200) }).safeParse(request.body)
    const browser = parseCookies(request.headers.cookie)[COOKIE]
    if (!body.success || !browser) return reply.code(400).send({ status: 'expired' })
    return withTransaction(pool,async (db) => {
      const row = (await db.query('SELECT * FROM google_oauth_states WHERE state_hash=$1 AND browser_hash=$2 AND expires_at>now() FOR UPDATE', [digest(body.data.flowId),digest(browser)])).rows[0]
      if (!row) return reply.code(400).send({ status: 'expired' })
      if (row.error_code) return reply.code(400).send({ status: 'failed' })
      if (!row.completed_at) return { status: 'pending' }
      if (row.purpose === 'login') {
        const user = (await db.query("SELECT * FROM users WHERE id=$1 AND status='active' FOR UPDATE", [row.completed_user_id])).rows[0]
        if (!user) return reply.code(403).send({ status: 'failed' })
        const token = generateSessionToken()
        await auth.createSession({ tokenHash: hashSessionToken(token),userId: user.id,organizationId: user.organization_id,expiresAt: new Date(Date.now()+SESSION_TTL_SECONDS*1000) },db)
        await audit.record(db,{ organizationId: user.organization_id,actorUserId: user.id,action: 'auth.google_login' })
        void reply.header('set-cookie',buildSessionCookie(token,{ maxAgeSeconds: SESSION_TTL_SECONDS,secure: options.cookieSecure }))
      }
      await db.query('DELETE FROM google_oauth_states WHERE state_hash=$1', [row.state_hash])
      return { status: 'complete' }
    })
  })
}
