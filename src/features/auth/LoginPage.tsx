import { useState, type FormEvent } from 'react'
import { LogIn } from 'lucide-react'
import { HttpAuthError } from '../../data/authPort'
import { useSession } from '../../app/sessionContext'

/**
 * Login ekrani (Paket 10): yalniz `api` modda ve oturum yokken gosterilir.
 * E-posta+parola ile gercek API oturumu acar; hata gercekci ve ayrimli gosterilir.
 * Kabul edilmis UI dilini (token/buton/alan) korur.
 */
export function LoginPage() {
  const session = useSession()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await session.login(email.trim(), password)
    } catch (caught) {
      if (caught instanceof HttpAuthError) {
        if (caught.kind === 'invalid_credentials') setError('E-posta veya parola hatalı.')
        else if (caught.kind === 'rate_limited') {
          setError(
            caught.retryAfterSeconds !== undefined
              ? `Çok fazla deneme yapıldı. ${caught.retryAfterSeconds} sn sonra tekrar deneyin.`
              : 'Çok fazla deneme yapıldı. Bir süre sonra tekrar deneyin.',
          )
        } else setError('Sunucuya ulaşılamıyor. Bağlantıyı kontrol edin.')
      } else {
        setError('Beklenmeyen bir hata oluştu. Tekrar deneyin.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit} aria-labelledby="login-title">
        <div className="login-card__brand">
          <span className="login-card__logo" aria-hidden="true">
            <img className="brand__logo brand__logo--light" src="/brand/logo-horizontal.png" alt="" />
            <img className="brand__logo brand__logo--dark" src="/brand/logo-mark-dark.png" alt="" />
          </span>
          <div>
            <h1 id="login-title">HasarBotu V2</h1>
            <p>Baran Global Ekspertiz · Operasyon</p>
          </div>
        </div>

        {session.status === 'expired' && (
          <p className="login-card__notice login-card__notice--warning" role="alert">
            Oturumunuz sona erdi. Devam etmek için tekrar giriş yapın.
          </p>
        )}
        {session.notice !== null && (
          <p className="login-card__notice" role="status">{session.notice}</p>
        )}

        <label className="login-field">
          <span>E-posta</span>
          <input
            type="email"
            name="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="ad.soyad@firma.example"
            required
          />
        </label>
        <label className="login-field">
          <span>Parola</span>
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Parolanız"
            required
          />
        </label>

        {error !== null && (
          <p className="login-card__error" role="alert">{error}</p>
        )}

        <button className="button button--primary button--block" type="submit" disabled={submitting}>
          <LogIn size={16} /> {submitting ? 'Giriş yapılıyor…' : 'Giriş Yap'}
        </button>

        <p className="login-card__foot">Oturum güvenli çerezle sunucuda tutulur; parola tarayıcıda saklanmaz.</p>
      </form>
    </div>
  )
}
