import type { LucideIcon } from 'lucide-react'
import { ArrowRight, Construction } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

interface PlaceholderPageProps {
  title: string
  description: string
  icon?: LucideIcon
  bullets: readonly string[]
}

export function PlaceholderPage({ title, description, icon: Icon = Construction, bullets }: PlaceholderPageProps) {
  const navigate = useNavigate()
  return (
    <main className="page placeholder-page">
      <section className="placeholder-page__content">
        <span className="placeholder-page__icon"><Icon size={25} /></span>
        <span className="eyebrow">Tıklanabilir UI prototipi</span>
        <h1>{title}</h1>
        <p>{description}</p>
        <ul>{bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>
        <button className="button button--primary" type="button" onClick={() => navigate('/dosyalar')}>Dosyalar ekranına git <ArrowRight size={15} /></button>
      </section>
      <aside className="placeholder-page__note">
        <strong>Bu aşamanın sınırı</strong>
        <p>Sayfa navigasyonda çalışır; gerçek servis, veri yazma veya dış sistem bağlantısı içermez.</p>
      </aside>
    </main>
  )
}
