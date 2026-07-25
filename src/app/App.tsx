import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router'
import { AppShell } from '../components/AppShell'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { LoadingState } from '../components/StateViews'
import { CasesPage } from '../features/cases/CasesPage'
import { ClosedCasesPage } from '../features/closed/ClosedCasesPage'
import { DashboardPage } from '../features/dashboard/DashboardPage'
import { LegislationPage } from '../features/legislation/LegislationPage'
import { ManagementPage } from '../features/management/ManagementPage'
import { NotificationsPage } from '../features/notifications/NotificationsPage'
import { PlaceholderPage } from '../features/placeholder/PlaceholderPage'
import { ReportsPage } from '../features/reports/ReportsPage'
import { SettingsPage } from '../features/settings/SettingsPage'
import { LoginPage } from '../features/auth/LoginPage'
import { SessionProvider } from './session'
import { useSession } from './sessionContext'
import { usePersistentState } from './usePersistentState'

const CaseDetailPage = lazy(async () => {
  const module = await import('../features/cases/CaseDetailPage')
  return { default: module.CaseDetailPage }
})

interface AppRoutesProps {
  theme: 'light' | 'dark'
  density: 'compact' | 'comfortable'
  collapsed: boolean
  onThemeChange: (theme: 'light' | 'dark') => void
  onDensityChange: (density: 'compact' | 'comfortable') => void
  onSidebarChange: (collapsed: boolean) => void
}

function AppRoutes(props: AppRoutesProps) {
  return (
    <Routes>
      <Route path="/" element={<DashboardPage />} />
      <Route path="/dosyalar" element={<CasesPage />} />
      <Route path="/dosyalar/:caseId" element={<CaseDetailPage />} />
      <Route path="/kapanan-dosyalar" element={<ClosedCasesPage />} />
      <Route path="/raporlar-ve-ucretler" element={<ReportsPage />} />
      <Route path="/mevzuat-ve-ai" element={<LegislationPage />} />
      <Route path="/bildirimler" element={<NotificationsPage />} />
      <Route path="/yonetim" element={<ManagementPage />} />
      <Route path="/ayarlar" element={<SettingsPage theme={props.theme} density={props.density} collapsed={props.collapsed} onThemeChange={props.onThemeChange} onDensityChange={props.onDensityChange} onSidebarChange={props.onSidebarChange} />} />
      <Route path="*" element={<PlaceholderPage title="Sayfa Bulunamadı" description="İstenen görünüm bu prototipte bulunmuyor." bullets={['Ana navigasyonu kullanın', 'Dosyalar ekranına dönebilirsiniz']} />} />
    </Routes>
  )
}

interface AppGateProps extends AppRoutesProps {
  collapsed: boolean
  onMenuToggle: () => void
  onThemeToggle: () => void
  onDensityToggle: () => void
}

/**
 * Oturum kapisi: development/test `mock` modda baseline aynen render edilir.
 * `api` modda oturum bootstrap edilene kadar yukleme, oturum yoksa/sona erdiyse
 * login ekrani; yalniz kimlikli oturumda korumali uygulama rotalari acilir.
 * Production build veri kaynagini zorunlu `api` olarak cozer.
 */
function AppGate(props: AppGateProps) {
  const session = useSession()

  if (session.mode === 'api' && session.status === 'bootstrapping') {
    return <div className="login-screen"><LoadingState label="Oturum doğrulanıyor" /></div>
  }
  if (session.mode === 'api' && session.status !== 'authenticated') {
    return <LoginPage />
  }

  return (
    <AppShell
      collapsed={props.collapsed}
      theme={props.theme}
      density={props.density}
      onMenuToggle={props.onMenuToggle}
      onThemeToggle={props.onThemeToggle}
      onDensityToggle={props.onDensityToggle}
    >
      <Suspense fallback={<LoadingState label="Görünüm hazırlanıyor" />}>
        <AppRoutes theme={props.theme} density={props.density} collapsed={props.collapsed} onThemeChange={props.onThemeChange} onDensityChange={props.onDensityChange} onSidebarChange={props.onSidebarChange} />
      </Suspense>
    </AppShell>
  )
}

export function App() {
  const [theme, setTheme] = usePersistentState<'light' | 'dark'>('hasarbotu-theme', 'light')
  const [density, setDensity] = usePersistentState<'compact' | 'comfortable'>('hasarbotu-density', 'compact')
  const [collapsed, setCollapsed] = usePersistentState('hasarbotu-sidebar-collapsed', false)

  return (
    <ErrorBoundary>
      <div data-theme={theme} data-density={density} className="theme-root">
        <BrowserRouter>
          <SessionProvider>
            <AppGate
              theme={theme}
              density={density}
              collapsed={collapsed}
              onThemeChange={setTheme}
              onDensityChange={setDensity}
              onSidebarChange={setCollapsed}
              onMenuToggle={() => setCollapsed((value) => !value)}
              onThemeToggle={() => setTheme((value) => value === 'light' ? 'dark' : 'light')}
              onDensityToggle={() => setDensity((value) => value === 'compact' ? 'comfortable' : 'compact')}
            />
          </SessionProvider>
        </BrowserRouter>
      </div>
    </ErrorBoundary>
  )
}
