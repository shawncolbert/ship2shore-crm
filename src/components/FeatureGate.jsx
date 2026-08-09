import { useQuery } from '@tanstack/react-query'
import { Navigate } from 'react-router-dom'
import { fetchMyOrg } from '../lib/supabase'
import { isFeatureEnabled } from '../lib/features'

// Hiding a nav link isn't real access control on its own -- this is what
// actually stops a disabled feature from being reached by typing its URL
// directly. Every gated route in main.jsx wraps its element in this.
export default function FeatureGate({ featureKey, children }) {
  const { data: org, isLoading } = useQuery({ queryKey: ['myOrg'], queryFn: fetchMyOrg, staleTime: 5 * 60 * 1000 })
  // Don't redirect before we actually know -- a flash-redirect on every
  // page load while the org is still loading would be worse than a beat
  // of nothing.
  if (isLoading) return null
  if (isFeatureEnabled(org, featureKey)) return children
  // Dashboard itself being off is the one case "go to /" would loop --
  // Help is the one page that should realistically always stay on.
  return <Navigate to={featureKey === 'dashboard' ? '/help' : '/'} replace />
}
