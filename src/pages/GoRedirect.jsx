import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'

// Public, no auth gate. /go/:slug -- logs a click for an externally-hosted
// digital business card, then bounces straight to its real URL. The card
// itself lives elsewhere entirely; this route only ever sees a name + a URL.
export default function GoRedirect() {
  const { slug } = useParams()
  const [err, setErr] = useState('')
  const fired = useRef(false)

  useEffect(() => {
    if (fired.current) return
    fired.current = true
    fetch('/.netlify/functions/external-card-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data.target_url) throw new Error(data.error || 'This link is not set up.')
        window.location.replace(data.target_url)
      })
      .catch((e) => setErr(e.message || 'This link is not set up.'))
  }, [slug])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-[#0c1a24] px-6 text-center">
      {err ? (
        <>
          <h1 className="text-xl font-bold text-white">Link not found</h1>
          <p className="text-sm text-white/50">{err}</p>
        </>
      ) : (
        <p className="text-sm text-white/50">Redirecting…</p>
      )}
    </div>
  )
}
