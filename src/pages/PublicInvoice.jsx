import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import InvoicePreview from '../components/InvoicePreview'

async function fetchPublicInvoice(id) {
  const res = await fetch('/.netlify/functions/public-invoice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Could not load this invoice.')
  return data
}

// No auth gate -- this is the link a customer gets emailed. Deliberately
// read-only and shows nothing beyond what's needed to review and pay.
export default function PublicInvoice() {
  const { id } = useParams()
  const { data, isLoading, error } = useQuery({
    queryKey: ['publicInvoice', id], queryFn: () => fetchPublicInvoice(id), retry: false,
  })

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-100 text-sm text-slate-500">Loading…</div>
  }
  if (error || !data?.invoice) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 text-center text-sm text-slate-500">
        {error?.message || 'This invoice could not be found.'}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-10">
      <InvoicePreview
        businessInfo={data.businessInfo}
        invoice={data.invoice}
        lineItems={data.lineItems}
        paymentOptions={data.paymentOptions}
      />
    </div>
  )
}
