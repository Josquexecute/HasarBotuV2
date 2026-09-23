import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'

/** Apply once after login; later visits to the dashboard remain navigable. */
export function StartupPage() {
  const applied = useRef(false)
  const location = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    if (applied.current) return
    applied.current = true
    if (location.pathname !== '/' || location.search || location.hash) return
    try {
      if (JSON.parse(localStorage.getItem('hasarbotu-default-page') ?? 'null') === 'Dosyalar') {
        void navigate('/dosyalar', { replace: true })
      }
    } catch { /* Invalid or unavailable preferences retain the dashboard default. */ }
  }, [location, navigate])
  return null
}
