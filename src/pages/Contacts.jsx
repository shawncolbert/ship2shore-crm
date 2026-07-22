import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { fetchContacts } from '../lib/supabase'
import SegmentFilter from '../components/SegmentFilter'
import Badge from '../components/Badge'

export default function Contacts() {
  const [segment, setSegment] = useState(null)
  const [search, setSearch] = useState('')

  const { data, isLoading, error } = useQuery({
    queryKey: ['contacts', segment, search],
    queryFn: () => fetchContacts({ segment, search }),
  })

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-ink">
          Contacts
        </h1>
        <p className="text-sm text-muted">Brokers, dispatchers, and clients.</p>
      </header>

      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <SegmentFilter value={segment} onChange={setSegment} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, company, phone…"
          className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 md:w-72"
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        {isLoading && <div className="p-8 text-center text-sm text-muted">Loading…</div>}
        {error && (
          <div className="p-8 text-center text-sm text-port">
            Couldn’t load contacts. Check your Supabase keys and that you’re signed in.
          </div>
        )}
        {!isLoading && !error && data?.length === 0 && (
          <div className="p-10 text-center">
            <p className="text-sm font-medium text-ink">No contacts yet</p>
            <p className="mt-1 text-sm text-muted">
              Import your master list to fill the pipeline. We’ll wire that up next.
            </p>
          </div>
        )}
        {data?.map((c, i) => (
          <Link
            key={c.id}
            to={`/contacts/${c.id}`}
            className={`flex items-center justify-between px-4 py-3 hover:bg-canvas ${
              i !== 0 ? 'border-t border-line' : ''
            }`}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium text-ink">
                  {c.full_name || 'Unnamed contact'}
                </span>
                <Badge segment={c.segment} />
              </div>
              <div className="truncate text-xs text-muted">
                {[c.company, c.phone].filter(Boolean).join(' · ')}
              </div>
            </div>
            <span className="ml-3 text-muted">›</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
