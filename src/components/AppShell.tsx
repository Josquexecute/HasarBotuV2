import { useEffect, useState, type ReactNode } from 'react'
import { CaseListCacheContext, createCaseListCache } from '../data/caseListCache'
import { ActiveCaseContext, type ActiveCase } from '../app/activeCase'
import { TouchAssistant } from './TouchAssistant'
import { StartupPage } from '../app/StartupPage'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

interface AppShellProps {
  children: ReactNode
  collapsed: boolean
  theme: 'light' | 'dark'
  onMenuToggle: () => void
  onThemeToggle: () => void
}

export function AppShell(props: AppShellProps) {
  const [caseListCache] = useState(createCaseListCache)
  const [activeCase, setActiveCase] = useState<ActiveCase | null>(null)
  const [narrow, setNarrow] = useState(() => window.innerWidth < 1024)
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(() => {
    const update = () => setNarrow(window.innerWidth < 1024)
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  const toggleMenu = () => { if (narrow) setMenuOpen((value) => !value); else props.onMenuToggle() }
  return (
    <ActiveCaseContext.Provider value={setActiveCase}>
    <CaseListCacheContext.Provider value={caseListCache}>
    <StartupPage />
    <div className={`app-shell${menuOpen ? ' app-shell--menu-open' : ''}`}>
      {narrow && menuOpen && <button className="sidebar-backdrop" type="button" aria-label="Menüyü kapat" onClick={() => setMenuOpen(false)} />}
      <Sidebar collapsed={narrow ? false : props.collapsed} onToggle={toggleMenu} onNavigate={() => setMenuOpen(false)} />
      <div className="app-shell__main">
        <Topbar
          theme={props.theme}
          onMenuToggle={toggleMenu}
          onThemeToggle={props.onThemeToggle}
        />
        <div className="workspace">{props.children}</div>
      </div>
      <TouchAssistant target={activeCase} showTrigger={false} />
    </div>
    </CaseListCacheContext.Provider>
    </ActiveCaseContext.Provider>
  )
}
