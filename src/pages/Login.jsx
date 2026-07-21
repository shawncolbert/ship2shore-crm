import { useState } from 'react'
import { supabase, isConfigured } from '../lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const sendLink = async () => {
    setError(''); setBusy(true)
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    })
    setBusy(false)
    if (error) setError(error.message)
    else setSent(true)
  }

  return (
    <div className="flex h-full items-center justify-center bg-ink p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="font-[family-name:var(--font-display)] text-2xl font-bold text-white">
            Ship2Shore
          </div>
          <div className="text-xs uppercase tracking-[0.2em] text-accent">Dispatch</div>
        </div>

        <div className="rounded-xl bg-surface p-6 shadow-xl">
          {!isConfigured && (
            <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Supabase keys aren’t set yet. Add them to <code>.env</code> and restart.
            </p>
          )}

          {sent ? (
            <div className="text-center">
              <p className="text-sm font-medium text-ink">Check your email</p>
              <p className="mt-1 text-sm text-muted">
                We sent a sign-in link to {email}. Open it on this device.
              </p>
            </div>
          ) : (
            <>
              <label className="block text-sm font-medium text-ink">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="shawn@ship2shorebooking.com"
                className="mt-1.5 w-full rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
              />
              {error && <p className="mt-2 text-xs text-port">{error}</p>}
              <button
                onClick={sendLink}
                disabled={busy || !email}
                className="mt-4 w-full rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-accent-600 disabled:opacity-50"
              >
                {busy ? 'Sending…' : 'Send sign-in link'}
              </button>
              <p className="mt-3 text-center text-xs text-muted">
                No password — we email you a one-time link.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
