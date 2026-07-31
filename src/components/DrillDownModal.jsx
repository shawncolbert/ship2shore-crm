import { useEffect } from 'react'
import { Link } from 'react-router-dom'

const money = (n) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(n || 0))

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null

// Reusable drill-down list, opened from any clickable stat card. Each row
// carries { id, contactId, contactName, jobTitle, stageName, date, value } and
// links to that contact's page — same place every other job/contact reference
// in this app sends you, since there's no separate single-opportunity view.
export default function DrillDownModal({ open, onClose, title, subtitle, rows, isLoading, error, emptyMessage }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="relative flex max-h-[85vh] w-full max-w-lg flex-col rounded-t-2xl border border-line bg-surface shadow-xl sm:max-h-[80vh] sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="font-[family-name:var(--font-display)] text-lg font-bold text-ink">{title}</h2>
            {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-muted hover:bg-canvas hover:text-ink"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading && <div className="p-8 text-center text-sm text-muted">Loading…</div>}
          {error && <div className="p-8 text-center text-sm text-port">Couldn’t load this list.</div>}
          {!isLoading && !error && (!rows || rows.length === 0) && (
            <div className="p-8 text-center text-sm text-muted">{emptyMessage || 'Nothing here yet.'}</div>
          )}
          {!isLoading && !error && rows?.map((r, i) => (
            <Link
              key={r.id}
              to={r.contactId ? `/contacts/${r.contactId}` : '#'}
              onClick={onClose}
              className={`flex items-center justify-between gap-3 px-5 py-3 hover:bg-canvas ${i !== 0 ? 'border-t border-line' : ''}`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-ink">{r.contactName}</span>
                  {r.stageName && (
                    <span className="shrink-0 rounded-full bg-canvas px-2 py-0.5 text-[10px] font-semibold text-muted ring-1 ring-inset ring-line">
                      {r.stageName}
                    </span>
                  )}
                </div>
                <div className="truncate text-xs text-muted">
                  {[r.jobTitle, fmtDate(r.date)].filter(Boolean).join(' · ')}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {r.value != null && (
                  <span className="font-[family-name:var(--font-mono)] text-sm text-ink">{money(r.value)}</span>
                )}
                <span className="text-muted">›</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
