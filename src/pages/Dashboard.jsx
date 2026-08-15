import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchDashboardStats, fetchOpenPipelineJobs, fetchClosedJobs, fetchNewLeadsList, fetchJobsByStage,
  fetchNewCustomerFiles, markAttachmentViewed, fetchMyOrg,
} from '../lib/supabase'
import { fetchMyExternalCards } from '../lib/externalCards'
import { fetchCustomLinks } from '../lib/customLinks'
import { isFeatureEnabled } from '../lib/features'
import DrillDownModal from '../components/DrillDownModal'
import BookingSidebar from '../components/BookingSidebar'

// Quick-action tiles for the grouped-sidebar layouts' dashboard grid --
// each a big icon badge linking straight to the feature, the way both
// reference screenshots laid these out as tiles rather than a plain nav
// list. `auroraBg` is Aurora's solid per-tile color; Dispatch Suite instead
// uses one uniform translucent brass badge for every tile, matching its
// demo's `.quick .ic` treatment -- so it doesn't need a per-tile color.
const QUICK_ACTIONS = [
  { to: '/contacts', label: 'Contacts', hint: 'Manage leads & clients', icon: '👥', auroraBg: '#3d1150', key: 'contacts' },
  { to: '/pipeline', label: 'Pipeline', hint: 'Track jobs in progress', icon: '📋', auroraBg: '#6b1e6b', key: 'pipeline' },
  { to: '/calendar', label: 'Calendar', hint: 'Bookings & availability', icon: '📅', auroraBg: '#8f2d7d', key: 'calendar' },
  { to: '/payment-settings', label: 'Payments', hint: 'Send & track payment requests', icon: '💳', auroraBg: '#4a1a5c', key: 'payments' },
  { to: '/documents', label: 'Documents', hint: 'Delivery orders & files', icon: '🗂️', auroraBg: '#5c1e6e', key: 'documents' },
  { to: '/landing-pages', label: 'Landing Pages', hint: 'Public marketing pages', icon: '🌐', auroraBg: '#7a2470', key: 'landing_pages' },
]

const money = (n) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
    .format(Number(n || 0))

// Each drill-down knows how to fetch its own rows and what to show as the
// modal title/subtitle/empty state. Keyed by `kind` so react-query caches
// each list separately.
const DRILLDOWNS = {
  open: {
    title: 'Open pipeline',
    subtitle: 'Not yet completed, paid or canceled',
    emptyMessage: 'Nothing open right now.',
    fetch: fetchOpenPipelineJobs,
  },
  closed7: {
    title: 'Jobs closed · 7 days',
    subtitle: 'Moved to Completed or Paid',
    emptyMessage: 'No jobs closed in the last 7 days.',
    fetch: () => fetchClosedJobs(7),
  },
  closed30: {
    title: 'Jobs closed · 30 days',
    subtitle: 'Moved to Completed or Paid',
    emptyMessage: 'No jobs closed in the last 30 days.',
    fetch: () => fetchClosedJobs(30),
  },
  leads: {
    title: 'New leads · 7 days',
    subtitle: 'Contacts added this week',
    emptyMessage: 'No new contacts this week.',
    fetch: () => fetchNewLeadsList(7),
  },
  newFiles: {
    title: 'New files from customers',
    subtitle: "Sent through their upload link — you haven't opened these yet",
    emptyMessage: 'Nothing new.',
    fetch: fetchNewCustomerFiles,
  },
}

export default function Dashboard() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: fetchDashboardStats,
  })
  const { data: org } = useQuery({ queryKey: ['myOrg'], queryFn: fetchMyOrg, staleTime: 5 * 60 * 1000 })
  const isAurora = org?.theme_preset === 'aurora'
  const isDispatchSuite = org?.theme_preset === 'dispatch_suite'
  const showQuickActions = isAurora || isDispatchSuite
  const { data: newFilesCount } = useQuery({
    queryKey: ['newCustomerFilesCount'],
    queryFn: async () => (await fetchNewCustomerFiles()).length,
    refetchInterval: 60_000,
  })
  const { data: externalCards } = useQuery({
    queryKey: ['externalCards'],
    queryFn: fetchMyExternalCards,
    refetchInterval: 60_000,
  })
  const { data: customLinks } = useQuery({ queryKey: ['customLinks'], queryFn: fetchCustomLinks, staleTime: 5 * 60 * 1000 })
  const cardClicks = (externalCards || []).reduce((sum, c) => sum + (c.click_count || 0), 0)
  // { kind } for the stat cards, or { kind: 'stage', stageId, stageName } for a per-stage row.
  const [drillDown, setDrillDown] = useState(null)
  const [bookingSidebarOpen, setBookingSidebarOpen] = useState(false)

  const openDrillDown = (kind) => setDrillDown({ kind })
  const openStageDrillDown = (stageId, stageName) => setDrillDown({ kind: 'stage', stageId, stageName })
  const closeDrillDown = () => setDrillDown(null)

  const config = drillDown?.kind === 'stage'
    ? { title: `Jobs in ${drillDown.stageName}`, subtitle: null, emptyMessage: 'No jobs in this stage.', fetch: () => fetchJobsByStage(drillDown.stageId, drillDown.stageName) }
    : drillDown ? DRILLDOWNS[drillDown.kind] : null

  const drillQuery = useQuery({
    queryKey: ['dashboardDrillDown', drillDown?.kind, drillDown?.stageId],
    queryFn: config?.fetch,
    enabled: !!drillDown,
  })

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-ink">
            Dashboard
          </h1>
          <p className="text-sm text-muted">Your pipeline at a glance. Click a number to see what's behind it.</p>
        </div>
        <button
          onClick={() => setBookingSidebarOpen(true)}
          className="h-fit shrink-0 bg-accent hover:bg-accent-600 text-ink font-semibold py-2 px-4 rounded text-sm"
        >
          + New Booking
        </button>
      </header>

      {isLoading && <p className="text-sm text-muted">Loading…</p>}
      {error && <p className="text-sm text-port">Couldn’t load stats.</p>}

      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <Stat label="Digital business cards" value={externalCards?.length ?? '—'}
              hint={`${cardClicks} click${cardClicks === 1 ? '' : 's'} total — click to view all`}
              onClick={() => navigate('/settings/card-links')} />
            <Stat label="Open pipeline value" value={money(data.openValue)} mono accent
              hint="Not yet completed, paid or canceled" onClick={() => openDrillDown('open')} />
            <Stat label="Jobs closed · 7 days" value={data.closedThisWeek}
              hint="Moved to Completed or Paid" onClick={() => openDrillDown('closed7')} />
            <Stat label="Jobs closed · 30 days" value={data.closedThisMonth}
              hint="Moved to Completed or Paid" onClick={() => openDrillDown('closed30')} />
            <Stat label="New leads · 7 days" value={data.newLeadsWeek}
              hint="Contacts added this week" onClick={() => openDrillDown('leads')} />
            <Stat label="New files from customers" value={newFilesCount ?? '—'} accent={!!newFilesCount}
              hint="Sent via their upload link" onClick={() => openDrillDown('newFiles')} />
          </div>

          {showQuickActions && (
            <div className="mt-6">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Quick actions</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {QUICK_ACTIONS.filter((a) => isFeatureEnabled(org, a.key)).map((a) => (
                  <button
                    key={a.to}
                    type="button"
                    onClick={() => navigate(a.to)}
                    className="flex items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 text-left shadow-[var(--shadow-card)] transition-transform hover:-translate-y-0.5"
                  >
                    <span
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl"
                      style={isDispatchSuite ? { background: 'rgba(212,175,106,0.14)', color: 'var(--color-brass)' } : { background: a.auroraBg }}
                    >
                      {a.icon}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-ink">{a.label}</span>
                      <span className="block truncate text-xs text-muted">{a.hint}</span>
                    </span>
                  </button>
                ))}
              </div>

              {customLinks?.length > 0 && (
                <div className="mt-6">
                  <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Custom links</h2>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {customLinks.map((l) => (
                      <a
                        key={l.id}
                        href={l.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 text-left shadow-[var(--shadow-card)] transition-transform hover:-translate-y-0.5"
                      >
                        <span
                          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl"
                          style={isDispatchSuite ? { background: 'rgba(212,175,106,0.14)', color: 'var(--color-brass)' } : { background: '#4a1a5c' }}
                        >
                          🔗
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-ink">{l.label}</span>
                          <span className="block truncate text-xs text-muted">Opens in a new tab</span>
                        </span>
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="mt-6 rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
                Jobs by stage
              </h2>
              <span className="text-xs text-muted">{data.totalJobs} total</span>
            </div>
            {data.byStage.every((s) => s.count === 0) ? (
              <p className="text-sm text-muted">
                No jobs yet — they’ll appear here once bookings start flowing in.
              </p>
            ) : (
              <div className="space-y-3">
                {data.byStage.map((s) => {
                  const max = Math.max(...data.byStage.map((x) => x.count), 1)
                  return (
                    <button
                      key={s.name}
                      type="button"
                      onClick={() => openStageDrillDown(s.id, s.name)}
                      disabled={s.count === 0}
                      className="flex w-full items-center gap-3 rounded-md text-left transition-colors hover:bg-canvas disabled:cursor-default disabled:hover:bg-transparent"
                    >
                      <span className="w-28 shrink-0 text-sm text-ink">{s.name}</span>
                      <div className="h-2 flex-1 rounded-full bg-canvas">
                        <div
                          className="h-2 rounded-full bg-accent"
                          style={{ width: `${(s.count / max) * 100}%` }}
                        />
                      </div>
                      <span className="w-6 text-right text-sm font-medium text-ink">{s.count}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}

      <DrillDownModal
        open={!!drillDown}
        onClose={closeDrillDown}
        title={config?.title}
        subtitle={config?.subtitle}
        emptyMessage={config?.emptyMessage}
        rows={drillQuery.data}
        isLoading={drillQuery.isLoading}
        error={drillQuery.error}
        onRowClick={drillDown?.kind === 'newFiles' ? (row) => {
          markAttachmentViewed(row.id).then(() => qc.invalidateQueries({ queryKey: ['newCustomerFilesCount'] }))
        } : undefined}
      />

      <BookingSidebar
        open={bookingSidebarOpen}
        onClose={() => setBookingSidebarOpen(false)}
      />
    </div>
  )
}

function Stat({ label, value, mono, accent, hint, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)] text-left transition-colors hover:border-accent hover:bg-canvas"
    >
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div
        className={`mt-2 text-3xl font-bold ${accent ? 'text-starboard' : 'text-ink'} ${
          mono ? 'font-[family-name:var(--font-mono)]' : 'font-[family-name:var(--font-display)]'
        }`}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-[11px] text-muted">{hint}</div>}
    </button>
  )
}
