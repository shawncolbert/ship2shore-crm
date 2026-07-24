import { useState } from 'react'
import { useParams } from 'react-router-dom'

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1])
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

export default function PublicUpload() {
  const { token } = useParams()
  const [file, setFile] = useState(null)
  const [status, setStatus] = useState('idle') // idle | sending | done | error
  const [err, setErr] = useState('')

  async function submit(e) {
    e.preventDefault()
    if (!file) return
    if (file.size > 8 * 1024 * 1024) { setErr('File is too large (max 8 MB).'); setStatus('error'); return }
    setStatus('sending'); setErr('')
    try {
      const dataBase64 = await toBase64(file)
      const res = await fetch('/.netlify/functions/public-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, filename: file.name, contentType: file.type, dataBase64 }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok && j.ok) setStatus('done')
      else { setErr(j.error || `Upload failed (${res.status}).`); setStatus('error') }
    } catch (e2) { setErr(e2.message); setStatus('error') }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-8 shadow-sm">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-ink">Send your delivery order</h1>
        <p className="mt-1 text-sm text-muted">Upload your delivery order or paperwork for Ship2Shore. PDF or photo, up to 8&nbsp;MB.</p>

        {status === 'done' ? (
          <div className="mt-6 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            ✅ Received — thank you! Your delivery order was sent to Ship2Shore.
            <div className="mt-3">
              <button className="rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-canvas"
                onClick={() => { setFile(null); setStatus('idle') }}>Upload another</button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6">
            <input type="file" required
              accept=".pdf,.png,.jpg,.jpeg,.heic,.doc,.docx,.xls,.xlsx"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="block w-full text-sm text-ink file:mr-3 file:rounded-lg file:border-0 file:bg-accent file:px-4 file:py-2 file:text-sm file:font-semibold file:text-ink hover:file:bg-accent-600" />
            {file && <p className="mt-2 text-xs text-muted">{file.name} · {Math.max(1, Math.round(file.size / 1024))} KB</p>}
            <button disabled={status === 'sending' || !file}
              className="mt-5 w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-ink hover:bg-accent-600 disabled:opacity-50">
              {status === 'sending' ? 'Uploading…' : 'Upload delivery order'}
            </button>
            {status === 'error' && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-port">⚠️ {err}</p>}
          </form>
        )}
      </div>
    </div>
  )
}
