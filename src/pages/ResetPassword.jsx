import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

// Where a "reset your password" email link lands. Supabase's redirect
// establishes a short-lived recovery session automatically before this
// page even mounts (it's baked into the link itself) -- this page's only
// job is collecting the new password and calling updateUser with it.
export default function ResetPassword() {
  const navigate = useNavigate()
  const [ready, setReady] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    // A recovery link's session can take a beat to land after redirect --
    // wait for it rather than assuming it's already there on first render.
    supabase.auth.getSession().then(({ data }) => setReady(!!data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => setReady(!!session))
    return () => sub.subscription.unsubscribe()
  }, [])

  const save = async (e) => {
    e.preventDefault()
    if (password.length < 6) { setError('Password needs to be at least 6 characters.'); return }
    if (password !== confirm) { setError('Passwords don\'t match.'); return }
    setError(''); setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) { setError(error.message); return }
    setDone(true)
    setTimeout(() => navigate('/'), 1500)
  }

  return (
    <div className="flex h-full items-center justify-center bg-brand p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="font-[family-name:var(--font-display)] text-2xl font-bold text-white">Ship2Shore</div>
          <div className="text-xs uppercase tracking-[0.2em] text-accent">Dispatch</div>
        </div>

        <div className="rounded-xl bg-surface p-6 shadow-xl">
          {done ? (
            <p className="text-sm text-ink">✓ Password set. Taking you to your dashboard…</p>
          ) : !ready ? (
            <>
              <p className="text-sm text-muted">Checking your reset link…</p>
              <p className="mt-3 text-xs text-muted">
                If this sits here for more than a few seconds, the link has likely expired — go back and
                request a new one from the sign-in page.
              </p>
            </>
          ) : (
            <form onSubmit={save}>
              <p className="mb-4 text-sm text-muted">Set a new password for your account.</p>
              <label className="block text-sm font-medium text-ink">New password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="••••••••"
                className="mt-1.5 w-full rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
              />
              <label className="mt-4 block text-sm font-medium text-ink">Confirm new password</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                placeholder="••••••••"
                className="mt-1.5 w-full rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
              />
              {error && <p className="mt-2 text-xs text-port">{error}</p>}
              <button
                type="submit"
                disabled={busy || !password || !confirm}
                className="mt-5 w-full rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-accent-600 disabled:opacity-50"
              >
                {busy ? 'Saving…' : 'Set password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
