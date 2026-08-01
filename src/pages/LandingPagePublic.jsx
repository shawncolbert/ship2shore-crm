import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

async function callLandingPageApi(payload) {
  const res = await fetch('/.netlify/functions/public-landing-page', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}

export default function LandingPagePublic() {
  const { slug } = useParams()
  const { data, isLoading, error } = useQuery({
    queryKey: ['landingPagePublic', slug],
    queryFn: () => callLandingPageApi({ action: 'get', slug }),
    retry: false,
  })

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center bg-[#f3f4f6] text-sm text-gray-500">Loading…</div>
  }
  if (error || !data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-[#f3f4f6] px-6 text-center">
        <h1 className="text-xl font-bold text-gray-900">Page not found</h1>
        <p className="text-sm text-gray-500">This page doesn't exist or isn't published yet.</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#f3f4f6]">
      <title>{data.title}</title>
      <div className="mx-auto max-w-2xl px-5 py-10 sm:py-16">
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
          <div className="bg-[#1a1a1a] px-6 py-5 sm:px-10">
            <span className="text-xs font-bold uppercase tracking-[0.14em] text-[#e8a317]">Ship2Shore</span>
          </div>
          <div className="px-6 py-8 sm:px-10 sm:py-12">
            {(data.blocks || []).map((block, i) => <Block key={block.id || i} block={block} slug={slug} />)}
          </div>
        </div>
      </div>
    </div>
  )
}

function Block({ block, slug }) {
  switch (block.type) {
    case 'heading':
      return <h1 className="mb-4 text-2xl font-bold text-gray-900 sm:text-3xl">{block.text}</h1>
    case 'paragraph':
      return <p className="mb-4 whitespace-pre-wrap text-base leading-relaxed text-gray-700">{block.text}</p>
    case 'image':
      return block.url ? (
        <img src={block.url} alt={block.alt || ''} className="mb-4 w-full rounded-xl object-cover" />
      ) : null
    case 'cta':
      return <CtaBlock block={block} slug={slug} />
    default:
      return null
  }
}

function CtaBlock({ block, slug }) {
  const [showForm, setShowForm] = useState(false)

  if (block.target === 'booking') {
    return (
      <a
        href="/book"
        className="mb-4 mt-2 inline-block rounded-xl bg-[#e8a317] px-8 py-4 text-center text-base font-bold text-[#1a1a1a] hover:brightness-95"
      >
        {block.label || 'Book Now'}
      </a>
    )
  }

  return (
    <div className="mb-4 mt-2">
      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="rounded-xl bg-[#e8a317] px-8 py-4 text-base font-bold text-[#1a1a1a] hover:brightness-95"
        >
          {block.label || 'Contact us'}
        </button>
      ) : (
        <LeadForm slug={slug} />
      )}
    </div>
  )
}

function LeadForm({ slug }) {
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', notes: '' })
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async (e) => {
    e.preventDefault()
    if (!form.full_name.trim() || !form.email.trim()) { setErr('Name and email are required.'); return }
    setSending(true); setErr('')
    try {
      await callLandingPageApi({ action: 'submit_lead', slug, ...form })
      setDone(true)
    } catch (e2) {
      setErr(e2.message || 'Something went wrong. Please try again.')
    } finally {
      setSending(false)
    }
  }

  if (done) {
    return (
      <div className="rounded-xl border-2 border-[#e8a317] bg-[#fdf6e8] p-6 text-center">
        <p className="font-semibold text-gray-900">Thanks — we'll be in touch shortly.</p>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-5">
      {err && <p className="text-sm text-red-600">{err}</p>}
      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Name</label>
        <input className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#e8a317]"
          value={form.full_name} onChange={(e) => set('full_name', e.target.value)} required />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Email</label>
        <input type="email" className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#e8a317]"
          value={form.email} onChange={(e) => set('email', e.target.value)} required />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Phone (optional)</label>
        <input className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#e8a317]"
          value={form.phone} onChange={(e) => set('phone', e.target.value)} />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Message (optional)</label>
        <textarea rows={3} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#e8a317]"
          value={form.notes} onChange={(e) => set('notes', e.target.value)} />
      </div>
      <button type="submit" disabled={sending}
        className="w-full rounded-lg bg-[#e8a317] px-4 py-3 text-sm font-bold text-[#1a1a1a] hover:brightness-95 disabled:opacity-50">
        {sending ? 'Sending…' : 'Send'}
      </button>
    </form>
  )
}
