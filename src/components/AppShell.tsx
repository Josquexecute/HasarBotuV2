import { useEffect, useState, type ReactNode } from 'react'
import { CaseListCacheContext, createCaseListCache } from '../data/caseListCache'
import { ActiveCaseContext, type ActiveCase } from '../app/activeCase'
import { TouchAssistant } from './TouchAssistant'
import { StartupPage } from '../app/StartupPage'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { ModalFrame } from './ModalFrame'

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
    const update = () => { setNarrow(window.innerWidth < 1024); if (window.innerWidth >= 1024) setMenuOpen(false) }
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  const toggleMenu = () => { if (narrow) setMenuOpen((value) => !value); else props.onMenuToggle() }
  return (
    <ActiveCaseContext.Provider value={setActiveCase}>
    <CaseListCacheContext.Provider value={caseListCache}>
    <StartupPage />
    <div className={`app-shell${menuOpen ? ' app-shell--menu-open' : ''}`}>
      {narrow ? menuOpen && <ModalFrame className="mobile-navigation" labelledBy="mobile-navigation-title" onClose={() => setMenuOpen(false)}>
        <h2 id="mobile-navigation-title" className="sr-only">Ana menü</h2>
        <Sidebar collapsed={false} onToggle={toggleMenu} onNavigate={() => setMenuOpen(false)} toggleLabel="Menüyü kapat" />
      </ModalFrame> : <Sidebar collapsed={props.collapsed} onToggle={toggleMenu} />}
      <div className="app-shell__main" inert={narrow && menuOpen}>
        <Topbar
          theme={props.theme}
          onMenuToggle={toggleMenu}
          onThemeToggle={props.onThemeToggle}
          menuExpanded={narrow ? menuOpen : !props.collapsed}
        />
        <div className="workspace">{props.children}</div>
      </div>
      <TouchAssistant target={activeCase} showTrigger={false} />
    </div>
    </CaseListCacheContext.Provider>
    </ActiveCaseContext.Provider>
  )
}
