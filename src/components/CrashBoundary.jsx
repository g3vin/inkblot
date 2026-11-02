/**
 * CrashBoundary — what the window shows when the page fails to render.
 *
 * It saves a crash report (src/lib/diagnostics) and offers a reload. Documents are
 * saved as they are written, so a reload loses at most the last keystrokes, and the
 * fallback says so rather than leaving a blank window. The reload is announced to the
 * native side first, so it is not itself reported as a crash.
 */
import { Component } from 'react'
import { Button, EmptyState } from '../ui'
import { expectReload, reportRenderCrash } from '../lib/diagnostics'
import './CrashBoundary.css'

export default class CrashBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { crashed: false }
  }

  static getDerivedStateFromError() {
    return { crashed: true }
  }

  componentDidCatch(error, info) {
    reportRenderCrash(error, info?.componentStack)
  }

  render() {
    if (!this.state.crashed) return this.props.children
    const reload = async () => {
      await expectReload()
      window.location.reload()
    }
    return (
      <main className="crash-boundary">
        <EmptyState
          icon="warning"
          title="Something went wrong"
          hint="Inkblot saved a crash report. Your writing is saved on disk; reload to carry on."
          action={<Button variant="filled" onClick={reload}>Reload</Button>}
        />
      </main>
    )
  }
}
