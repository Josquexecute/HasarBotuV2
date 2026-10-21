const uuid = '[a-fA-F0-9-]{36}'
const googleResult = /^\/api\/v1\/google\/result\/(web|field|desktop)\/(login|mail)\/(success|pending|approval|denied|expired|failed)$/

export function isGoogleResultRedirect(method, pathname, status, location) {
  return method === 'GET' && status === 303 && (pathname === '/api/v1/google/callback' || googleResult.test(pathname))
    && typeof location === 'string' && googleResult.test(location)
}

export function allowedFieldApi(method, pathname) {
  if (pathname === '/api/v1/auth/login' || pathname === '/api/v1/auth/logout') return method === 'POST'
  if (pathname === '/api/v1/auth/session' || pathname === '/api/v1/field/cases') return method === 'GET'
  if (pathname === '/api/v1/google/status' || pathname === '/api/v1/google/callback') return method === 'GET'
  if (googleResult.test(pathname)) return method === 'GET'
  if (pathname === '/api/v1/google/start' || pathname === '/api/v1/google/complete') return method === 'POST'
  if (new RegExp(`^/api/v1/field/cases/${uuid}/photos$`).test(pathname)) return method === 'GET'
  if (new RegExp(`^/api/v1/field/cases/${uuid}/uploads$`).test(pathname)) return method === 'POST'
  if (new RegExp(`^/api/v1/field/uploads/${uuid}/chunk$`).test(pathname)) return method === 'PUT'
  if (new RegExp(`^/api/v1/field/uploads/${uuid}/(finish|retry|cancel)$`).test(pathname)) return method === 'POST'
  return method === 'GET' && new RegExp(`^/api/v1/field/uploads/${uuid}/(jpeg|original)$`).test(pathname)
}
