import { useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchMyOrg } from '../lib/supabase'

const ACTIVITY_EVENTS = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'wheel']

// Optional per-org "kiosk mode" (see Appearance settings) -- after N idle
// minutes with no mouse/keyboard/touch activity, send the browser back to
// the branded "Enter CRM" front door. Off by default; nothing changes for
// an org until they turn it on. Mounted once in Layout so it's active
// anywhere in the authenticated app.
export default function IdleTimeout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { data: org } = useQuery({ queryKey: ['myOrg'], queryFn: fetchMyOrg, staleTime: 5 * 60 * 1000 })

  const enabled = !!org?.idle_timeout_enabled
  const minutes = org?.idle_timeout_minutes || 60

  useEffect(() => {
    if (!enabled) return

    let timer
    const reset = () => {
      clearTimeout(timer)
      timer = setTimeout(() => navigate('/', { replace: true }), minutes * 60_000)
    }

    reset()
    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, reset, { passive: true }))
    return () => {
      clearTimeout(timer)
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, reset))
    }
    // Re-arm on every navigation too, so moving between pages counts as
    // activity instead of silently ticking toward the idle clock.
  }, [enabled, minutes, navigate, location.pathname])

  return null
}
