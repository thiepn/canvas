import { Component, type ErrorInfo, type ReactNode } from 'react'
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) { if (import.meta.env.DEV) console.error('Canvas initialization failed.', error, info.componentStack) }
  render() {
    if (this.state.error) return <main className="app-message" role="alert"><h1>Canvas</h1><h2>Could not open the canvas</h2><p>{this.state.error.message}</p><p>Your server’s saved canvas has not been reset. Check configuration and network access, then reload.</p><button type="button" onClick={() => location.reload()}>Reload Canvas</button></main>
    return this.props.children
  }
}
