import { useQuery } from '@tanstack/react-query'
import { fetchDashboardStats } from '../lib/supabase'

const money = (n) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
    .format(Number(n || 0))

export default function Dashboard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: fetchDashboardStats,
  })

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-ink">
          Dashboard
        </h1>
        <p className="text-sm text-muted">Your jobs at a glance.</p>
      </header>

      {isLoading && <p className="text-sm text-muted">Loading…</p>}
      {error && <p className="text-sm text-port">Couldn’t load stats.</p>}

      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Total jobs" value={data.totalJobs} />
            <Stat label="Open value" value={money(data.openValue)} mono />
            <Stat label="Won value" value={money(data.wonValue)} mono accent />
          </div>

          <div className="mt-6 rounded-xl border border-line bg-surface p-5">
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted">
              Jobs by stage
            </h2>
            {data.byStage.every((s) => s.count === 0) ? (
              <p className="text-sm text-muted">
                No jobs yet — they’ll appear here once bookings start flowing in.
              </p>
            ) : (
              <div className="space-y-3">
                {data.byStage.map((s) => {
                  const max = Math.max(...data.byStage.map((x) => x.count), 1)
                  return (
                    <div key={s.name} className="flex items-center gap-3">
                      <span className="w-28 shrink-0 text-sm text-ink">{s.name}</span>
                      <div className="h-2 flex-1 rounded-full bg-canvas">
                        <div
                          className="h-2 rounded-full bg-accent"
                          style={{ width: `${(s.count / max) * 100}%` }}
                        />
                      </div>
                      <span className="w-6 text-right text-sm font-medium text-ink">{s.count}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, mono, accent }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div
        className={`mt-2 text-3xl font-bold ${accent ? 'text-starboard' : 'text-ink'} ${
          mono ? 'font-[family-name:var(--font-mono)]' : 'font-[family-name:var(--font-display)]'
        }`}
      >
        {value}
      </div>
    </div>
  )
}
