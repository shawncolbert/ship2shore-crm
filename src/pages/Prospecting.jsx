import { useState } from 'react'
import { Link } from 'react-router-dom'
import { checkWarmLeads } from '../lib/prospecting'
import NewContactModal from '../components/NewContactModal'

const card = 'rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)]'
const btn = 'inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-canvas'
const btnAccent = 'inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] bg-accent px-3 py-2 text-sm font-semibold text-ink hover:bg-accent-600 disabled:opacity-50'
const h2 = 'mb-3 text-xs font-semibold uppercase tracking-wide text-muted'

// One prospect per line -- "Name, Phone, Email" (phone/email optional,
// comma-separated same as pasting straight out of a spreadsheet). Blank
// lines are skipped.
function parseProspects(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, phone, email] = line.split(',').map((p) => p.trim())
      return { name: name || '', phone: phone || '', email: email || '' }
    })
    .filter((p) => p.name || p.phone || p.email)
}

export default function Prospecting() {
  const [raw, setRaw] = useState('')
  const [checking, setChecking] = useState(false)
  const [results, setResults] = useState(null)
  const [err, setErr] = useState('')
  const [addingProspect, setAddingProspect] = useState(null)

  const run = async () => {
    const prospects = parseProspects(raw)
    if (!prospects.length) { setErr('Paste at least one prospect first — one per line.'); return }
    setErr(''); setChecking(true)
    try {
      const r = await checkWarmLeads(prospects)
      setResults(r)
    } catch (e) {
      setErr(e.message || 'Could not check these prospects.')
    } finally {
      setChecking(false)
    }
  }

  const warmCount = results?.filter((r) => r.matches.length > 0).length || 0

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-ink">Prospecting</h1>
        <p className="text-sm text-muted">
          Paste in a list of leads before you reach out — anyone who matches an existing contact gets flagged
          "warm" instead of a cold call.
        </p>
      </header>

      <div className={`${card} mb-6`}>
        <h2 className={h2}>Check a lead list</h2>
        <p className="mb-2 text-sm text-muted">
          One prospect per line: <span className="font-[family-name:var(--font-mono)] text-ink">Name, Phone, Email</span> — phone
          and email are optional, but a match needs at least one of name, phone, or email to check against.
        </p>
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          rows={6}
          placeholder={'Jane Diaz, 555-0100, jane@example.com\nMike Torres,, mike@example.com'}
          className="w-full rounded-lg border border-line bg-canvas px-3 py-2 font-[family-name:var(--font-mono)] text-sm text-ink outline-none focus:border-accent"
        />
        {err && <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-port">⚠️ {err}</p>}
        <div className="mt-3 flex justify-end">
          <button className={btnAccent} disabled={checking} onClick={run}>
            {checking ? 'Checking…' : 'Check for warm leads'}
          </button>
        </div>
      </div>

      {results && (
        <div className={card}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className={h2 + ' mb-0'}>
              Results — {warmCount} warm, {results.length - warmCount} cold
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-muted">
                  <th className="py-1.5 pr-2">Prospect</th>
                  <th className="py-1.5 pr-2">Phone</th>
                  <th className="py-1.5 pr-2">Email</th>
                  <th className="py-1.5 pr-2">Status</th>
                  <th className="py-1.5 pr-0 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => {
                  const isWarm = r.matches.length > 0
                  return (
                    <tr key={i} className="border-b border-line last:border-0">
                      <td className="py-2 pr-2 text-ink">{r.prospect.name || '—'}</td>
                      <td className="py-2 pr-2 text-muted">{r.prospect.phone || '—'}</td>
                      <td className="py-2 pr-2 text-muted">{r.prospect.email || '—'}</td>
                      <td className="py-2 pr-2">
                        {isWarm ? (
                          <span className="rounded-full bg-accent/20 px-2 py-0.5 text-xs font-semibold text-ink">🔥 Warm</span>
                        ) : (
                          <span className="rounded-full bg-canvas px-2 py-0.5 text-xs font-medium text-muted">New lead</span>
                        )}
                      </td>
                      <td className="py-2 pr-0 text-right">
                        {isWarm ? (
                          <Link to={`/contacts/${r.matches[0].contact_id}`} className="text-xs font-semibold text-accent hover:underline">
                            {r.matches[0].contact_name || 'View match'} →
                          </Link>
                        ) : (
                          <button
                            onClick={() => setAddingProspect(r.prospect)}
                            className="text-xs font-semibold text-accent hover:underline"
                          >
                            + Add contact
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <NewContactModal
        open={!!addingProspect}
        onClose={() => setAddingProspect(null)}
        initial={addingProspect ? { full_name: addingProspect.name, phone: addingProspect.phone, email: addingProspect.email } : undefined}
      />
    </div>
  )
}
