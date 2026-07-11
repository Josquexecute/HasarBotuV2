import { type ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

interface AppShellProps {
  children: ReactNode
  collapsed: boolean
  theme: 'light' | 'dark'
  density: 'compact' | 'comfortable'
  onMenuToggle: () => void
  onThemeToggle: () => void
  onDensityToggle: () => void
}

export function AppShell(props: AppShellProps) {
  return (
    <div className="app-shell">
      <Sidebar collapsed={props.collapsed} onToggle={props.onMenuToggle} />
      <div className="app-shell__main">
        <Topbar
          theme={props.theme}
          density={props.density}
          onMenuToggle={props.onMenuToggle}
          onThemeToggle={props.onThemeToggle}
          onDensityToggle={props.onDensityToggle}
        />
        <div className="workspace">{props.children}</div>
      </div>
    </div>
  )
}
