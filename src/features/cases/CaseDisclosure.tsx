import { Suspense, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { LoadingState } from '../../components/StateViews'

export function CaseDisclosure({ label, icon, children }: { label: string; icon?: ReactNode; children: ReactNode }) {
  const [opened, setOpened] = useState(false)
  return <details className="case-disclosure" onToggle={event => { if (event.currentTarget.open) setOpened(true) }}>
    <summary><ChevronRight className="case-disclosure__chevron" size={16} aria-hidden="true" />{icon}{label}</summary>
    {opened && <div className="case-disclosure__body">
      <Suspense fallback={<LoadingState label="Yükleniyor" />}>{children}</Suspense>
    </div>}
  </details>
}
