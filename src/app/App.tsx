import { lazy, Suspense, useEffect, useState } from 'react'
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
import { PERSISTENCE_ERROR_EVENT, usePersistentState } from './usePersistentState'
const TrackingPopup = lazy(async () => ({ default: (await import('../features/tracking/TrackingPopup')).TrackingPopup }))
const DesktopAssistantPanel = lazy(async () => ({ default: (await import('../features/assistant/DesktopAssistantPanel')).DesktopAssistantPanel }))

const CaseDetailPage = lazy(async () => {
  const module = await import('../features/cases/CaseDetailPage')
  return { default: module.CaseDetailPage }
})

interface AppRoutesProps {
  theme: 'light' | 'dark'
  collapsed: boolean
  onThemeChange: (theme: 'light' | 'dark') => void
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
      <Route path="/ayarlar" element={<SettingsPage theme={props.theme} collapsed={props.collapsed} onThemeChange={props.onThemeChange} onSidebarChange={props.onSidebarChange} />} />
      <Route path="*" element={<PlaceholderPage title="Sayfa Bulunamadı" description="İstenen sayfa bulunamadı." bullets={['Ana navigasyonu kullanın', 'Dosyalar ekranına dönebilirsiniz']} />} />
    </Routes>
  )
}

interface AppGateProps extends AppRoutesProps {
  collapsed: boolean
  onMenuToggle: () => void
  onThemeToggle: () => void
}

/**
 * Oturum kapisi: development/test `mock` modda baseline aynen render edilir.
 * `api` modda oturum bootstrap edilene kadar yukleme, oturum yoksa/sona erdiyse
 * login ekrani; yalniz kimlikli oturumda korumali uygulama rotalari acilir.
 * Production build veri kaynagini zorunlu `api` olarak cozer.
 */
function AppGate(props: AppGateProps) {
  const session = useSession()

  if (window.location.pathname === '/touch-assistant') {
    return <Suspense fallback={<LoadingState label="Asistan hazırlanıyor" />}><DesktopAssistantPanel /></Suspense>
  }

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
      onMenuToggle={props.onMenuToggle}
      onThemeToggle={props.onThemeToggle}
    >
      <Suspense fallback={<LoadingState label="Görünüm hazırlanıyor" />}>
        {session.mode === 'api' && <TrackingPopup />}
        <AppRoutes theme={props.theme} collapsed={props.collapsed} onThemeChange={props.onThemeChange} onSidebarChange={props.onSidebarChange} />
      </Suspense>
    </AppShell>
  )
}

export function App() {
  const [persistenceFailed, setPersistenceFailed] = useState(false)
  useEffect(() => {
    const notify = () => setPersistenceFailed(true)
    window.addEventListener(PERSISTENCE_ERROR_EVENT, notify)
    return () => window.removeEventListener(PERSISTENCE_ERROR_EVENT, notify)
  }, [])
  const [theme, setTheme] = usePersistentState<'light' | 'dark'>('hasarbotu-theme', 'light')
  const [collapsed, setCollapsed] = usePersistentState('hasarbotu-sidebar-collapsed', false)

  return (
    <ErrorBoundary>
      <div data-theme={theme} data-density="compact" className="theme-root">
        {persistenceFailed && <p role="alert">Ayarlar bu cihazda saklanamadı. Değişiklikler yalnız bu oturumda geçerli.</p>}
        <BrowserRouter>
          <SessionProvider>
            <AppGate
              theme={theme}
              collapsed={collapsed}
              onThemeChange={setTheme}
              onSidebarChange={setCollapsed}
              onMenuToggle={() => setCollapsed((value) => !value)}
              onThemeToggle={() => setTheme((value) => value === 'light' ? 'dark' : 'light')}
            />
          </SessionProvider>
        </BrowserRouter>
      </div>
    </ErrorBoundary>
  )
}
