import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchMyOrg, updateMyOrgTheme } from '../lib/supabase'
import { applyTheme, cacheTheme, THEME_MODES, THEME_PRESETS } from '../lib/theme'

const card = 'rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)]'
const btnAccent = 'inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] bg-accent px-3 py-2 text-sm font-semibold text-ink hover:bg-accent-600 disabled:opacity-50'
const h2 = 'mb-3 text-xs font-semibold uppercase tracking-wide text-muted'

export default function Appearance() {
  const queryClient = useQueryClient()
  const { data: org, isLoading } = useQuery({ queryKey: ['myOrg'], queryFn: fetchMyOrg })

  const [mode, setMode] = useState('light')
  const [preset, setPreset] = useState('classic')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (org) { setMode(org.theme_mode || 'light'); setPreset(org.theme_preset || 'classic') }
  }, [org])

  // Kept in a ref (not the effect's closure) so the unmount cleanup below
  // always reverts to the latest saved org theme -- not whatever org looked
  // like when the preview effect last ran, which would be stale right after
  // a save (mode/preset don't change on save, so that effect wouldn't rerun).
  const savedTheme = useRef({ mode: org?.theme_mode, preset: org?.theme_preset })
  useEffect(() => {
    if (org) savedTheme.current = { mode: org.theme_mode, preset: org.theme_preset }
  }, [org])

  // Preview live as the org picks -- reverted on unmount if they navigate
  // away without saving, so browsing doesn't silently change the org's look.
  useEffect(() => {
    applyTheme(mode, preset)
    return () => applyTheme(savedTheme.current.mode, savedTheme.current.preset)
  }, [mode, preset])

  const dirty = org && (mode !== org.theme_mode || preset !== org.theme_preset)

  async function save() {
    setSaving(true); setErr(''); setSaved(false)
    try {
      await updateMyOrgTheme({ theme_mode: mode, theme_preset: preset })
      cacheTheme(mode, preset)
      await queryClient.invalidateQueries({ queryKey: ['myOrg'] })
      setSaved(true)
    } catch (e) {
      setErr(e.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  if (isLoading || !org) return <div className="p-8 text-sm text-muted">Loading…</div>

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6 lg:p-8">
      <header className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-ink">Appearance</h1>
        <p className="max-w-lg text-sm text-muted">
          Pick a look for your dashboard — light or dark, and one of six layouts, each with its own sidebar
          treatment, card shape, and accent color. Same functionality either way; this changes the CRM for
          everyone in your organization.
        </p>
      </header>

      {err && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-port">⚠️ {err}</p>}

      <div className="space-y-5">
        <div className={card}>
          <h2 className={h2}>Mode</h2>
          <div className="flex gap-2">
            {THEME_MODES.map((m) => (
              <button
                key={m.key}
                onClick={() => { setMode(m.key); setSaved(false) }}
                className={`flex-1 rounded-lg border px-4 py-3 text-sm font-medium transition-colors ${
                  mode === m.key ? 'border-accent bg-accent/10 text-ink' : 'border-line bg-canvas text-muted hover:text-ink'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div className={card}>
          <h2 className={h2}>Layout</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {THEME_PRESETS.map((p) => (
              <button
                key={p.key}
                onClick={() => { setPreset(p.key); setSaved(false) }}
                className={`overflow-hidden rounded-lg border text-left transition-colors ${
                  preset === p.key ? 'border-accent' : 'border-line hover:border-accent/40'
                }`}
              >
                {/* Mini sidebar-shape preview -- this is the actual sidebar background,
                    so the picker shows what you're choosing rather than just a color dot. */}
                <div className="flex h-14 items-stretch">
                  <div className="w-6 shrink-0" style={{ background: p.sidebar }} />
                  <div className="flex flex-1 items-center justify-center bg-canvas">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.swatch }} />
                  </div>
                </div>
                <div className={`p-3 ${preset === p.key ? 'bg-accent/10' : 'bg-surface'}`}>
                  <span className="text-sm font-semibold text-ink">{p.label}</span>
                  <p className="mt-0.5 text-xs text-muted">{p.description}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3">
          {saved && !dirty && <span className="text-sm text-starboard">Saved ✓</span>}
          <button onClick={save} disabled={saving || !dirty} className={btnAccent}>
            {saving ? 'Saving…' : 'Save appearance'}
          </button>
        </div>
      </div>
    </div>
  )
}
