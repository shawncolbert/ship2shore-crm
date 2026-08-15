import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { fetchCompletedJobs, markInvoicePaidManually, setInvoiceStatus, unmarkInvoiceComplete } from '../lib/invoices'

const money = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n || 0))
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—')

const STATUS_OPTIONS = ['draft', 'sent', 'paid', 'overdue']

// A spreadsheet-style record of every job that's been marked done (see the
// "Mark job done" button on an invoice) -- one row per job, with the
// payment status as a live dropdown so you can update it right in the
// grid, like editing a cell in Google Sheets, instead of opening each
// invoice individually.
export default function CompletedJobs() {
  const qc = useQueryClient()
  const { data: jobs, isLoading } = useQuery({ queryKey: ['completedJobs'], queryFn: fetchCompletedJobs })

  const handleStatusChange = async (invoiceId, newStatus) => {
    if (newStatus === 'paid') {
      const method = prompt('How was this invoice paid? (e.g. Cash, Check, Venmo, Zelle)')
      if (method === null) return
      await markInvoicePaidManually(invoiceId, { paymentMethod: method })
    } else {
      await setInvoiceStatus(invoiceId, newStatus)
    }
    qc.invalidateQueries({ queryKey: ['completedJobs'] })
    qc.invalidateQueries({ queryKey: ['invoice', invoiceId] })
    qc.invalidateQueries({ queryKey: ['invoices'] })
  }

  const handleRemove = async (job) => {
    if (!window.confirm(`Remove "${job.invoice_number}" from Completed Jobs? This just un-marks it as done -- the invoice itself isn't deleted, and you can mark it done again any time.`)) return
    await unmarkInvoiceComplete(job.id)
    qc.invalidateQueries({ queryKey: ['completedJobs'] })
    qc.invalidateQueries({ queryKey: ['invoice', job.id] })
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-ink">Completed Jobs</h1>
        <p className="text-sm text-muted">
          Every job marked done (via the "Mark job done" button on its invoice) — job, who, when it was
          finished, when it was paid, and the whole billing picture in one spreadsheet-style list. Click the
          status cell to update it right here.
        </p>
      </header>

      {isLoading && <p className="text-sm text-muted">Loading…</p>}

      {!isLoading && jobs?.length === 0 && (
        <div className="rounded-[var(--radius-card)] border border-dashed border-line p-10 text-center">
          <p className="text-sm font-medium text-ink">No completed jobs yet</p>
          <p className="mt-1 text-sm text-muted">
            Open an invoice and click "Mark job done" once a job is finished — it'll show up here.
          </p>
        </div>
      )}

      {jobs?.length > 0 && (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-semibold">Customer</th>
                <th className="px-4 py-3 font-semibold">Invoice</th>
                <th className="px-4 py-3 font-semibold">Completed</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Paid</th>
                <th className="px-4 py-3 text-right font-semibold">Amount</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} className="group border-b border-line/60 last:border-0 hover:bg-canvas">
                  <td className="px-4 py-3 text-ink">{job.contacts?.full_name || job.contacts?.company || '—'}</td>
                  <td className="px-4 py-3">
                    <Link to={`/invoices/${job.id}`} className="font-semibold text-accent hover:underline">{job.invoice_number}</Link>
                  </td>
                  <td className="px-4 py-3 text-muted">{fmtDate(job.completed_at)}</td>
                  <td className="px-4 py-3">
                    <select
                      value={job.status}
                      onChange={(e) => handleStatusChange(job.id, e.target.value)}
                      className="rounded-md border border-line bg-canvas px-2 py-1 text-xs font-semibold uppercase tracking-wide text-ink outline-none focus:border-accent"
                    >
                      {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {job.paid_at ? `${fmtDate(job.paid_at)}${job.payment_method ? ` · ${job.payment_method}` : ''}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-ink">{money(job.total)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleRemove(job)}
                      title="Remove from Completed Jobs (un-mark done)"
                      className="rounded p-1 text-muted opacity-0 transition-opacity hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
