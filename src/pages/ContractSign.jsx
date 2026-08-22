import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'

const money = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n || 0))
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' }) : '')

async function fetchPublicContract(id) {
  const res = await fetch('/.netlify/functions/public-contract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Could not load this agreement.')
  return data
}

async function signContract(id, signerName) {
  const res = await fetch('/.netlify/functions/contract-sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, signerName }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Could not sign this agreement.')
  return data
}

// No auth gate -- this is the link a customer gets emailed. Review the
// terms, type your name, check the box, sign. The deposit invoice is
// created and emailed automatically the moment signing succeeds.
export default function ContractSign() {
  const { id } = useParams()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [signing, setSigning] = useState(false)
  const [signError, setSignError] = useState('')
  const [signResult, setSignResult] = useState(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['publicContract', id], queryFn: () => fetchPublicContract(id), retry: false,
  })

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-100 text-sm text-slate-500">Loading…</div>
  }
  if (error || !data?.contract) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 text-center text-sm text-slate-500">
        {error?.message || 'This agreement could not be found.'}
      </div>
    )
  }

  const { contract, businessInfo } = data
  const bizName = businessInfo?.invoice_business_name || businessInfo?.name || 'this business'
  const signed = contract.status === 'signed' || !!signResult
  const signerName = signResult?.signerName || contract.signer_name
  const signedAt = signResult ? new Date().toISOString() : contract.signed_at
  const depositInvoiceId = signResult?.depositInvoiceId ?? contract.deposit_invoice_id

  async function handleSign(e) {
    e.preventDefault()
    if (!name.trim() || !agreed || signing) return
    setSigning(true)
    setSignError('')
    try {
      const result = await signContract(id, name.trim())
      setSignResult(result)
      qc.invalidateQueries({ queryKey: ['publicContract', id] })
    } catch (err) {
      setSignError(err.message)
    } finally {
      setSigning(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-10">
      <div className="mx-auto w-full max-w-3xl rounded-lg border border-slate-200 bg-white p-8 text-slate-900 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-6">
          <div className="flex items-center gap-3">
            {businessInfo?.logo_url && <img src={businessInfo.logo_url} alt="" className="h-12 w-12 object-contain" />}
            <p className="text-sm font-bold text-slate-800">{bizName}</p>
          </div>
          <h1 className="text-2xl font-bold tracking-wide text-slate-800">BOOKING AGREEMENT</h1>
        </div>

        <div className="mt-6 flex flex-wrap gap-6 rounded-lg bg-slate-50 px-4 py-3 text-sm">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Total</p>
            <p className="font-bold text-slate-800">{money(contract.total_price)}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Deposit</p>
            <p className="font-bold text-slate-800">{money(contract.deposit_amount)}</p>
          </div>
        </div>

        <div className="mt-6 max-h-[50vh] overflow-y-auto whitespace-pre-line rounded-lg border border-slate-200 bg-white p-5 text-sm leading-relaxed text-slate-700">
          {contract.body}
        </div>

        {signed ? (
          <div className="mt-6 rounded-lg bg-emerald-50 px-5 py-4">
            <p className="text-sm font-semibold text-emerald-800">
              ✓ Signed by {signerName}{signedAt ? ` on ${fmtDateTime(signedAt)}` : ''}
            </p>
            {depositInvoiceId ? (
              <>
                <p className="mt-1 text-sm text-emerald-800">Your deposit invoice has been emailed to you.</p>
                <a
                  href={`/invoice/${depositInvoiceId}`}
                  className="mt-3 inline-block rounded-lg bg-emerald-600 px-5 py-2 text-sm font-bold text-white hover:bg-emerald-700"
                >
                  Pay your deposit now
                </a>
              </>
            ) : (
              <p className="mt-1 text-sm text-emerald-800">Thanks for confirming — we'll follow up with payment details shortly.</p>
            )}
          </div>
        ) : (
          <form onSubmit={handleSign} className="mt-6 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-5">
            <p className="text-sm font-semibold text-slate-800">Sign to confirm this booking</p>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Your full name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Type your full name"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500"
              />
            </div>
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5" />
              I have read and agree to the terms above.
            </label>
            {signError && <p className="text-sm text-red-600">{signError}</p>}
            <button
              type="submit"
              disabled={!name.trim() || !agreed || signing}
              className="rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-bold text-slate-900 hover:bg-amber-600 disabled:opacity-50"
            >
              {signing ? 'Signing…' : 'Sign & Confirm Booking'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
