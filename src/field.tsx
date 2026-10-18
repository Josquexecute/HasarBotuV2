import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { SessionProvider } from './app/session'
import { ErrorBoundary } from './components/ErrorBoundary'
import { FieldApp } from './features/field/FieldApp'

createRoot(document.getElementById('root')!).render(<StrictMode><div className="field-root"><ErrorBoundary><SessionProvider><FieldApp /></SessionProvider></ErrorBoundary></div></StrictMode>)
