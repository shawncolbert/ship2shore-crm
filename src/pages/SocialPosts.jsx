import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export default function SocialPosts() {
  const qc = useQueryClient()
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [showDraft, setShowDraft] = useState(false)

  const { data: posts, isLoading } = useQuery({
    queryKey: ['socialPosts'],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/.netlify/functions/social-posts-list', {
        headers: { Authorization: `Bearer ${session?.access_token || ''}` },
      })
      const json_data = await res.json()
      if (!res.ok) throw new Error(json_data.error || 'Failed to fetch posts')
      return json_data.posts || []
    },
  })

  const { data: tiktokStatus } = useQuery({
    queryKey: ['tiktokStatus'],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/.netlify/functions/social-posts-tiktok-status', {
        headers: { Authorization: `Bearer ${session?.access_token || ''}` },
      })
      if (!res.ok) return { connected: false }
      return res.json()
    },
    staleTime: 60 * 1000,
  })

  const [connectNotice, setConnectNotice] = useState(null)

  // Landed back here after TikTok's own consent screen (see tiktok-oauth-callback).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const result = params.get('tiktok')
    if (!result) return
    if (result === 'connected') setConnectNotice({ type: 'success', text: 'TikTok account connected.' })
    else setConnectNotice({ type: 'error', text: params.get('msg') || 'Could not connect TikTok.' })
    qc.invalidateQueries({ queryKey: ['tiktokStatus'] })
    window.history.replaceState({}, '', window.location.pathname)
  }, [qc])

  const handlePostCreated = () => {
    setShowDraft(false)
    qc.invalidateQueries({ queryKey: ['socialPosts'] })
  }

  const [connecting, setConnecting] = useState(false)
  const handleConnectTiktok = async () => {
    setConnecting(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/.netlify/functions/tiktok-oauth-start', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token || ''}` },
      })
      const data = await res.json()
      if (!res.ok) { setConnectNotice({ type: 'error', text: data.error || 'Could not start TikTok connection' }); return }
      window.location.href = data.authorize_url
    } finally {
      setConnecting(false)
    }
  }

  // Group posts by date
  const postsByDate = {}
  posts?.forEach((post) => {
    const dateStr = post.scheduled_date?.split('T')[0]
    if (dateStr) {
      if (!postsByDate[dateStr]) postsByDate[dateStr] = []
      postsByDate[dateStr].push(post)
    }
  })

  if (isLoading) return <div className="p-8 text-sm text-muted">Loading…</div>

  return (
    <div className="flex h-full flex-col p-4 sm:p-6 lg:p-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-ink">
            Social Media Planner
          </h1>
          <p className="text-sm text-muted">Draft and plan social posts for future dates.</p>
        </div>
        <button
          onClick={() => setShowDraft(true)}
          className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-ink hover:bg-accent-600"
        >
          New post
        </button>
      </header>

      {connectNotice && (
        <div className={`mb-4 rounded-lg border px-4 py-3 text-sm ${connectNotice.type === 'success' ? 'border-accent/40 bg-accent/10 text-ink' : 'border-red-300 bg-red-50 text-red-700'}`}>
          {connectNotice.type === 'success' ? '✅ ' : '⚠️ '}{connectNotice.text}
        </div>
      )}

      {tiktokStatus && !tiktokStatus.connected && tiktokStatus.appConfigured && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span>⚠️ No TikTok account connected. Connect one so posts marked "auto-publish" actually go out.</span>
          <button
            onClick={handleConnectTiktok}
            disabled={connecting}
            className="shrink-0 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {connecting ? 'Redirecting…' : 'Connect TikTok'}
          </button>
        </div>
      )}

      {tiktokStatus && !tiktokStatus.connected && !tiktokStatus.appConfigured && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          ⚠️ TikTok isn't set up on this site yet — an admin needs to create a TikTok Developer app and set
          TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET before a "Connect TikTok" button can appear here. Posts set
          to auto-publish will fail until then.
        </div>
      )}

      {tiktokStatus?.connected && (
        <div className="mb-4 rounded-lg border border-line bg-surface px-4 py-2 text-xs text-muted">
          ✅ TikTok connected{tiktokStatus.username ? ` as @${tiktokStatus.username}` : ''}.
        </div>
      )}

      {showDraft && <DraftForm onClose={() => setShowDraft(false)} onSaved={handlePostCreated} tiktokConnected={tiktokStatus?.connected} />}

      <div className="grid gap-4 lg:grid-cols-2">
        {posts?.map((post) => (
          <PostCard key={post.id} post={post} onUpdated={handlePostCreated} />
        ))}
      </div>

      {posts?.length === 0 && <p className="text-sm text-muted">No posts yet. Create one to get started.</p>}
    </div>
  )
}

function PostCard({ post, onUpdated }) {
  const qc = useQueryClient()
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    if (!window.confirm('Delete this post?')) return
    setDeleting(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/.netlify/functions/social-posts-delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token || ''}`,
        },
        body: JSON.stringify({ postId: post.id }),
      })
      if (res.ok) {
        qc.invalidateQueries({ queryKey: ['socialPosts'] })
      }
    } finally {
      setDeleting(false)
    }
  }

  const scheduledDate = post.scheduled_date
    ? new Date(post.scheduled_date).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'Not scheduled'

  const statusBadge = {
    draft: '📝 Draft',
    scheduled: post.platform === 'tiktok' ? '⏳ Scheduled to auto-publish (TikTok)' : '⏳ Scheduled',
    published: '✅ Published' + (post.platform === 'tiktok' ? ' to TikTok' : ''),
    failed: '❌ Failed',
  }[post.status] || post.status

  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          {post.image_url && (
            <img src={post.image_url} alt="Post" className="mb-3 max-h-40 w-full rounded-lg object-cover" />
          )}
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{post.text}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className="rounded-full bg-canvas px-2 py-0.5">📅 {scheduledDate}</span>
            <span className={`rounded-full px-2 py-0.5 ${post.status === 'failed' ? 'bg-red-50 text-red-600' : post.status === 'published' ? 'bg-accent/15 text-accent' : 'bg-canvas'}`}>
              {statusBadge}
            </span>
          </div>
          {post.status === 'failed' && post.publish_error && (
            <p className="mt-2 text-xs text-red-600">{post.publish_error}</p>
          )}
          {post.status === 'published' && post.published_url && (
            <a href={post.published_url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs text-accent hover:underline">
              View on TikTok →
            </a>
          )}
        </div>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="shrink-0 rounded p-1 text-muted hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
        >
          ✕
        </button>
      </div>
    </div>
  )
}

function DraftForm({ onClose, onSaved, tiktokConnected }) {
  const [text, setText] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [scheduledDate, setScheduledDate] = useState('')
  const [autoPublishTiktok, setAutoPublishTiktok] = useState(false)
  const [tiktokPrivacyLevel, setTiktokPrivacyLevel] = useState('SELF_ONLY')
  const [tiktokIsAigc, setTiktokIsAigc] = useState(false)
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!text.trim()) { setErr('Post text is required'); return }
    if (!scheduledDate) { setErr('Scheduled date is required'); return }
    if (autoPublishTiktok && !imageUrl.trim()) { setErr('An image URL is required to auto-publish to TikTok'); return }

    setSaving(true)
    setErr('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/.netlify/functions/social-posts-create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token || ''}`,
        },
        body: JSON.stringify({
          text,
          imageUrl: imageUrl || null,
          scheduledDate,
          autoPublishTiktok,
          tiktokPrivacyLevel,
          tiktokIsAigc,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save post')
      onSaved()
    } catch (e) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mb-6 rounded-xl border border-line bg-surface p-5">
      <h2 className="mb-3 text-sm font-semibold text-ink">Draft new post</h2>
      {err && <p className="mb-3 text-xs text-port">{err}</p>}

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted">Post text</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="What's on your mind?"
            rows={4}
            className="mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted">Image URL (optional)</label>
          <input
            type="url"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="https://example.com/image.jpg"
            className="mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted">Scheduled date & time</label>
          <input
            type="datetime-local"
            value={scheduledDate}
            onChange={(e) => setScheduledDate(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>

        <div className="rounded-lg border border-line bg-canvas/50 p-3">
          <label className="flex items-center gap-2 text-xs font-semibold text-ink">
            <input type="checkbox" checked={autoPublishTiktok} onChange={(e) => setAutoPublishTiktok(e.target.checked)} />
            Auto-publish to TikTok at the scheduled time
          </label>
          {!tiktokConnected && (
            <p className="mt-1 text-xs text-amber-600">No TikTok account connected yet — click "Connect TikTok" above first, or this post will fail.</p>
          )}
          {autoPublishTiktok && (
            <div className="mt-3 space-y-2">
              <div>
                <label className="block text-xs text-muted">Who can see it on TikTok</label>
                <select
                  value={tiktokPrivacyLevel}
                  onChange={(e) => setTiktokPrivacyLevel(e.target.value)}
                  className="mt-1 w-full rounded border border-line bg-white px-2 py-1 text-xs outline-none focus:border-accent"
                >
                  <option value="SELF_ONLY">Only me</option>
                  <option value="FOLLOWER_OF_CREATOR">Followers</option>
                  <option value="MUTUAL_FOLLOW_FRIENDS">Friends</option>
                  <option value="PUBLIC_TO_EVERYONE">Everyone</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-xs text-muted">
                <input type="checkbox" checked={tiktokIsAigc} onChange={(e) => setTiktokIsAigc(e.target.checked)} />
                This image is AI-generated or AI-edited (TikTok requires this disclosure)
              </label>
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted hover:bg-canvas hover:text-ink">
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-ink hover:bg-accent-600 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save draft'}
        </button>
      </div>
    </div>
  )
}
