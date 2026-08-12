import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { fetchLandingPages, deleteLandingPage } from '../lib/supabase'
import NewLandingPageModal from '../components/NewLandingPageModal'
import { LANDING_TEMPLATES } from '../lib/landingTemplates'
import { PUBLIC_THEMES } from '../lib/publicThemes'

const card = 'rounded-xl border border-line bg-surface p-5'
const btnAccent = 'inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-ink hover:bg-accent-600'

const fmt = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''

export default function LandingPages() {
  const qc = useQueryClient()
  const [picking, setPicking] = useState(false)
  const { data: pages, isLoading, error } = useQuery({ queryKey: ['landingPages'], queryFn: fetchLandingPages })

  const remove = async (id, title) => {
    if (!confirm(`Delete "${title}"? This can't be undone.`)) return
    await deleteLandingPage(id)
    qc.invalidateQueries({ queryKey: ['landingPages'] })
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-ink">Landing pages</h1>
          <p className="max-w-2xl text-sm text-muted">
            Pick a prebuilt template, drop in the customer's details, publish. Pages render publicly at{' '}
            <code>/pages/&lt;slug&gt;</code> — no login required to view.
          </p>
        </div>
        <button onClick={() => setPicking(true)} className={btnAccent}>+ New page</button>
      </header>

      {picking && (
        <NewLandingPageModal
          onClose={() => setPicking(false)}
          onCreated={() => qc.invalidateQueries({ queryKey: ['landingPages'] })}
        />
      )}

      {isLoading && <p className="text-sm text-muted">Loading…</p>}
      {error && <p className="text-sm text-port">Couldn't load landing pages.</p>}
      {!isLoading && !error && pages?.length === 0 && (
        <div className={card}>
          <p className="text-sm text-muted">
            No landing pages yet. Hit <strong className="text-ink">+ New page</strong> and pick a template —
            there are {LANDING_TEMPLATES.length} ready to go with the copy already written.
          </p>
        </div>
      )}

      <div className="space-y-2">
        {pages?.map((p) => (
          <div key={p.id} className={`${card} flex flex-wrap items-center justify-between gap-3`}>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: PUBLIC_THEMES.find((t) => t.key === p.theme)?.accent || PUBLIC_THEMES[0].accent }} />
                <Link to={`/landing-pages/${p.id}`} className="truncate font-medium text-ink hover:text-accent">
                  {p.title}
                </Link>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                  p.published ? 'bg-starboard/15 text-starboard' : 'bg-canvas text-muted ring-1 ring-inset ring-line'
                }`}>
                  {p.published ? 'Published' : 'Draft'}
                </span>
              </div>
              <div className="mt-0.5 text-xs text-muted">
                /pages/{p.slug} · updated {fmt(p.updated_at)}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {p.published && (
                <a href={`/pages/${p.slug}`} target="_blank" rel="noreferrer" className="text-xs font-medium text-accent hover:underline">
                  View live ↗
                </a>
              )}
              <Link to={`/landing-pages/${p.id}`} className="text-xs font-medium text-ink hover:text-accent">Edit</Link>
              <button onClick={() => remove(p.id, p.title)} className="text-xs font-medium text-port hover:underline">Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
