import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Arayüz hatası:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="fatal-state">
          <AlertTriangle aria-hidden="true" />
          <h1>Bu görünüm yüklenemedi</h1>
          <p>Mock prototip beklenmeyen bir hatayla karşılaştı.</p>
          <button type="button" onClick={() => window.location.reload()}>
            Uygulamayı yenile
          </button>
        </main>
      )
    }

    return this.props.children
  }
}
