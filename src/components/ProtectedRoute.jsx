import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function ProtectedRoute({ children }) {
  const { session, loading } = useAuth()
  const location = useLocation()
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        Loading…
      </div>
    )
  }
  // Carries the originally-requested path (and its query string, e.g. a
  // Home Screen shortcut's ?new=1) through the login detour, so signing in
  // lands back where the link was actually pointed instead of always the
  // dashboard -- see Login.jsx's matching read of this state.
  if (!session) return <Navigate to="/login" state={{ from: location }} replace />
  return children
}
