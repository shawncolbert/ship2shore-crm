import { useAuth } from '../context/AuthContext'

// No login screen — the app silently signs itself in (see AuthContext) for
// personal use. We still wait for that sign-in to finish before rendering so
// the dashboard's data queries run with a valid session (RLS stays enforced).
export default function ProtectedRoute({ children }) {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        Loading…
      </div>
    )
  }

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-port">
        Couldn’t sign in automatically. Check that the auto-login credentials
        are configured.
      </div>
    )
  }

  return children
}
