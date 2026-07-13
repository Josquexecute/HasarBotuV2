import type { FastifyReply, FastifyRequest } from 'fastify'
import { failureBody } from '../errors/failure.js'
import { parseCookies, SESSION_COOKIE_NAME } from './cookies.js'
import { hashSessionToken } from './token.js'
import type { AuthStore, SessionRow } from './store.js'

/** Istekteki oturum cerezini cozer; aktif oturum yoksa undefined doner. */
export async function resolveSession(
  store: AuthStore,
  request: FastifyRequest,
): Promise<SessionRow | undefined> {
  const token = parseCookies(request.headers.cookie)[SESSION_COOKIE_NAME]
  if (token === undefined || token.length === 0) return undefined
  return store.findActiveSession(hashSessionToken(token))
}

/** Tekduze 401 yaniti. */
export function sendUnauthorized(reply: FastifyReply, requestId: string): void {
  void reply.code(401).send(failureBody('unauthorized', 'Authentication required.', requestId))
}

/** Yetki yetersiz: kimlik dogru ama rol izinsiz (403). */
export function sendForbidden(reply: FastifyReply, requestId: string): void {
  void reply.code(403).send(failureBody('forbidden', 'Insufficient permissions.', requestId))
}

/**
 * Korunan uclar icin oturum zorunlulugu. Ilk asamada butun aktif kullanicilar
 * tam yetkilidir (DECISIONS); rol/permission matrisi ileri paketlerdedir.
 * Oturum bulunursa doner, bulunmazsa 401 gonderir ve undefined doner.
 */
export async function requireSession(
  store: AuthStore,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<SessionRow | undefined> {
  const session = await resolveSession(store, request)
  if (session === undefined) {
    sendUnauthorized(reply, String(request.id))
    return undefined
  }
  return session
}
