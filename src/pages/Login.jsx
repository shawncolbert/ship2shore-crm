import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase, isConfigured } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { session, loading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [forgotMode, setForgotMode] = useState(false)
  const [forgotSent, setForgotSent] = useState(false)

  // Already signed in (or just signed in successfully) — go to the dashboard.
  // Without this, a successful sign-in leaves you sitting on /login.
  if (!loading && session) return <Navigate to="/" replace />

  const signIn = async (e) => {
    e?.preventDefault()
    setError(''); setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error) setError(error.message)
    // On success the auth listener updates the session and the app renders the
    // dashboard automatically. The session persists on this device, so you'll
    // rarely see this screen.
  }

  const sendReset = async (e) => {
    e?.preventDefault()
    if (!email.trim()) { setError('Enter your email first.'); return }
    setError(''); setBusy(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setBusy(false)
    if (error) setError(error.message)
    else setForgotSent(true)
  }

  if (forgotMode) {
    return (
      <div className="flex h-full items-center justify-center bg-brand p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center">
            <div className="font-[family-name:var(--font-display)] text-2xl font-bold text-white">
              Ship2Shore
            </div>
            <div className="text-xs uppercase tracking-[0.2em] text-accent">Dispatch</div>
          </div>

          <div className="rounded-xl bg-surface p-6 shadow-xl">
            {forgotSent ? (
              <>
                <p className="text-sm text-ink">
                  If an account exists for <strong>{email}</strong>, a password reset link is on its way — check
                  your email (and spam folder). The link is good for a limited time.
                </p>
                <button
                  onClick={() => { setForgotMode(false); setForgotSent(false); setError('') }}
                  className="mt-4 w-full rounded-md border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-canvas"
                >
                  Back to sign in
                </button>
              </>
            ) : (
              <form onSubmit={sendReset}>
                <p className="mb-4 text-sm text-muted">
                  Enter the email your account uses — we'll send a link to set a new password.
                </p>
                <label className="block text-sm font-medium text-ink">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username"
                  placeholder="you@example.com"
                  className="mt-1.5 w-full rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
                />
                {error && <p className="mt-2 text-xs text-port">{error}</p>}
                <button
                  type="submit"
                  disabled={busy || !email}
                  className="mt-5 w-full rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-accent-600 disabled:opacity-50"
                >
                  {busy ? 'Sending…' : 'Send reset link'}
                </button>
                <button
                  type="button"
                  onClick={() => { setForgotMode(false); setError('') }}
                  className="mt-3 w-full text-center text-xs text-muted hover:text-ink"
                >
                  Back to sign in
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full items-center justify-center bg-brand p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="font-[family-name:var(--font-display)] text-2xl font-bold text-white">
            Ship2Shore
          </div>
          <div className="text-xs uppercase tracking-[0.2em] text-accent">Dispatch</div>
        </div>

        <form onSubmit={signIn} className="rounded-xl bg-surface p-6 shadow-xl">
          {!isConfigured && (
            <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Supabase keys aren’t set yet. Add them to <code>.env</code> and restart.
            </p>
          )}

          <label className="block text-sm font-medium text-ink">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            placeholder="shawn@ship2shorebooking.com"
            className="mt-1.5 w-full rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          />

          <div className="mt-4 flex items-center justify-between">
            <label className="block text-sm font-medium text-ink">Password</label>
            <button
              type="button"
              onClick={() => { setForgotMode(true); setError('') }}
              className="text-xs font-medium text-accent hover:underline"
            >
              Forgot password?
            </button>
          </div>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            placeholder="••••••••"
            className="mt-1.5 w-full rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          />

          {error && <p className="mt-2 text-xs text-port">{error}</p>}

          <button
            type="submit"
            disabled={busy || !email || !password}
            className="mt-5 w-full rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-accent-600 disabled:opacity-50"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <p className="mt-3 text-center text-xs text-muted">
            You’ll stay signed in on this device.
          </p>
        </form>
      </div>
    </div>
  )
}
