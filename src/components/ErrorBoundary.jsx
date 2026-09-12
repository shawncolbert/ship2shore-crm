import { Component } from 'react'

// A single misbehaving widget (the live map crashing on a phone that
// doesn't support what Mapbox needs, say) must never take the whole CRM
// down to a blank screen -- which is exactly what happened without this:
// React unmounts the entire tree on an uncaught render/effect error when
// nothing catches it. Scope this around anything that talks to a
// third-party browser API (maps, canvas, etc.) that can't be trusted to
// degrade gracefully on its own.
export default class ErrorBoundary extends Component {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info)
  }

  render() {
    if (this.state.hasError) return this.props.fallback ?? null
    return this.props.children
  }
}
