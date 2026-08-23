import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { fetchPendingPaymentClaims, acknowledgePaymentClaim } from '../lib/supabase'

// A customer said "I paid it" in an email -- not proof (only a bank's own
// Zelle notification is, see the Zelle review queue on Invoices), so this
// never touches an invoice. It just pops up while a dispatcher is actively
// using the app so they notice it and go check the bank, same info an
// internal alert email already sent for when they're not. Polls rather
// than using realtime, matching the rest of the app's React Query pattern.
export default function PaymentClaimToast() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { data: claims } = useQuery({
    queryKey: ['pendingPaymentClaims'],
    queryFn: fetchPendingPaymentClaims,
    refetchInterval: 30_000,
  })

  const claim = claims?.[0]
  if (!claim) return null

  const dismiss = async () => {
    try {
      await acknowledgePaymentClaim(claim.id)
    } finally {
      qc.invalidateQueries({ queryKey: ['pendingPaymentClaims'] })
    }
  }

  const openAndDismiss = async () => {
    if (claim.invoice_id) navigate(`/invoices/${claim.invoice_id}`)
    await dismiss()
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-4">
      <div className="pointer-events-auto flex w-full max-w-lg items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 shadow-lg">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-amber-900">
            {claim.contacts?.full_name || claim.sender_name || 'A customer'} says they already paid
            {claim.invoices?.invoice_number ? ` — ${claim.invoices.invoice_number}` : ''}
          </p>
          {claim.message_snippet && (
            <p className="mt-1 truncate text-xs text-amber-800">&ldquo;{claim.message_snippet}&rdquo;</p>
          )}
          <p className="mt-1 text-xs text-amber-700">Not confirmed by a bank notification yet — check your bank before marking anything paid.</p>
        </div>
        <div className="flex shrink-0 flex-col gap-1.5">
          {claim.invoice_id && (
            <button
              type="button"
              onClick={openAndDismiss}
              className="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600"
            >
              View invoice
            </button>
          )}
          <button
            type="button"
            onClick={dismiss}
            className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  )
}
