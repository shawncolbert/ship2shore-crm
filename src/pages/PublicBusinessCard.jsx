import { useEffect, useRef } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import BusinessCardView from '../components/businessCard/BusinessCardView'

async function callCard(payload) {
  const res = await fetch('/.netlify/functions/public-business-card', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}

export default function PublicBusinessCard() {
  const { slug } = useParams()
  const [searchParams] = useSearchParams()
  const isQrScan = searchParams.get('src') === 'qr'
  const loggedScan = useRef(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['publicBusinessCard', slug],
    queryFn: () => callCard({ action: 'get', slug }),
    retry: false,
  })

  // Log once per page load, only when the QR code itself was scanned (its
  // encoded URL carries ?src=qr) -- a normal shared-link visit never has it.
  useEffect(() => {
    if (!isQrScan || loggedScan.current || !data?.card) return
    loggedScan.current = true
    callCard({ action: 'log_event', slug, kind: 'scan' }).catch(() => {})
  }, [isQrScan, data, slug])

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center bg-[#0c1a24] text-sm text-white/50">Loading…</div>
  }
  if (error || !data?.card) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-[#0c1a24] px-6 text-center">
        <h1 className="text-xl font-bold text-white">Card not found</h1>
        <p className="text-sm text-white/50">This card may have been removed or isn't published yet.</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0c1a24] p-4">
      <title>{data.card.full_name || data.card.brand_name || 'Digital Business Card'}</title>
      <BusinessCardView
        card={data.card}
        mode="public"
        onSubmitLead={(form) => callCard({ action: 'submit_lead', slug, ...form })}
      />
    </div>
  )
}
