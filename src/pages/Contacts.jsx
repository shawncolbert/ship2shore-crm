import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { fetchContacts, deleteContact } from '../lib/supabase'
import SegmentFilter from '../components/SegmentFilter'
import Badge from '../components/Badge'
import NewContactModal from '../components/NewContactModal'
import BusinessCardScanner from '../components/BusinessCardScanner'

export default function Contacts() {
  const qc = useQueryClient()
  const [segment, setSegment] = useState(null)
  const [search, setSearch] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [showScanner, setShowScanner] = useState(false)
  const [deletingId, setDeletingId] = useState(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['contacts', segment, search],
    queryFn: () => fetchContacts({ segment, search }),
  })

  const handleDelete = async (e, contact) => {
    e.preventDefault(); e.stopPropagation()
    if (!window.confirm(`Delete ${contact.full_name || 'this contact'}? Their conversation history, timeline, and any uploaded documents/photos go with them. Jobs and invoices stay, just unlinked from a contact.`)) return
    setDeletingId(contact.id)
    try {
      await deleteContact(contact.id)
      qc.invalidateQueries({ queryKey: ['contacts'] })
    } catch (err) {
      alert(err.message || 'Could not delete this contact.')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-ink">
            Contacts
          </h1>
          <p className="text-sm text-muted">Brokers, dispatchers, and clients.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/contacts/import"
            className="rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-canvas"
          >
            Import
          </Link>
          <button
            onClick={() => setShowScanner(true)}
            className="rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-canvas"
          >
            📇 Scan card
          </button>
          <button
            onClick={() => setShowNew(true)}
            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-accent-600"
          >
            + New contact
          </button>
        </div>
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
              Import your master list to fill the pipeline —{' '}
              <Link to="/contacts/import" className="font-medium text-accent hover:underline">upload a CSV or vCard</Link>.
            </p>
          </div>
        )}
        {data?.map((c, i) => (
          <Link
            key={c.id}
            to={`/contacts/${c.id}`}
            className={`group flex items-center justify-between px-4 py-3 hover:bg-canvas ${
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
            <div className="ml-3 flex shrink-0 items-center gap-2">
              <button
                onClick={(e) => handleDelete(e, c)}
                disabled={deletingId === c.id}
                title="Delete contact"
                className="rounded p-1 text-muted opacity-0 transition-opacity hover:bg-red-50 hover:text-red-500 disabled:opacity-50 group-hover:opacity-100"
              >
                ✕
              </button>
              <span className="text-muted">›</span>
            </div>
          </Link>
        ))}
      </div>

      <NewContactModal open={showNew} onClose={() => setShowNew(false)} />
      <BusinessCardScanner open={showScanner} onClose={() => setShowScanner(false)} />
    </div>
  )
}
