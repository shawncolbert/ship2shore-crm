import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, fetchMyOrgId } from '../lib/supabase'

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
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
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

const PLATFORMS = ['instagram', 'facebook', 'tiktok']
const PLATFORM_LABEL = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok' }

const LINK_NOTE = {
  instagram: 'Instagram doesn’t allow clickable links in captions — "Link in bio" is written in on purpose. Set your booking link in your Instagram bio once and every post like this works from then on.',
  facebook: 'Facebook makes a link in your caption clickable automatically, so the real booking link is written straight into the text — no "link in bio" needed here.',
  tiktok: 'TikTok doesn’t allow clickable links in captions — "Link in bio" is written in on purpose. Set your booking link in your TikTok bio once and every post like this works from then on.',
}

// 20 preset ideas each, styled after what's actually working for real
// competitor accounts (a vehicle-specific header, a call-to-action or
// differentiator footer) -- picking one just fills the text field, still
// editable before "Add to photo".
const HEADER_IDEAS = [
  'PORT ESCORT AVAILABLE TODAY', 'FRESH OFF THE BOAT', 'JUST ESCORTED OFF THE PORT',
  'TWIC-CERTIFIED PORT ESCORT', 'LONG BEACH PORT PICKUP', 'WILMINGTON PORT PICKUP',
  '16 YEARS ON THE DOCKS', 'SAME-DAY PORT ESCORT', 'JDM IMPORT — READY FOR PICKUP',
  'YOUR CAR, DELIVERED SAFE', 'NO BROKER FEES', 'DIRECT PORT ESCORT SERVICE',
  'PORT TO YOUR DOOR', 'ANOTHER SUCCESSFUL PICKUP', 'CUSTOMS CLEARED — ON THE MOVE',
  'PORT ESCORT — DONE RIGHT', 'KEI TRUCK PICKUP COMPLETE', 'KNOW YOUR PORT ESCORT',
  'KEEPING IT MOVING SINCE DAY ONE', 'KEI TRUCKS, CLASSICS & MORE',
]
const FOOTER_IDEAS = [
  '(310) 748-0040 · Book Now', 'Link in Bio to Book', 'TWIC-Certified — 16 Years Experience',
  'Long Beach & Wilmington — Same-Day Available', 'Direct Escort Service — No Broker Fees',
  'Book Your Port Pickup Today', 'DM to Book Your Escort', 'ship2shorebooking.com',
  'Serving All Southern California Ports', 'Reliable. Certified. On Time.',
  'Ask About JDM Import Help', 'Your Trusted Port Escort', 'Escorts • Transport • JDM Imports',
  'Call or Text (310) 748-0040', 'Booking Now for This Week', '16 Years, Thousands of Safe Pickups',
  'Free Basic Consults', 'Fast, Friendly, Certified', 'Ship2Shore Booking — Long Beach',
  'Get Your Free Quote Today',
]

function howToSteps(platform, autoPublishTiktok) {
  if (platform === 'tiktok' && autoPublishTiktok) {
    return ['This one posts itself at the scheduled time — nothing else for you to do.']
  }
  const app = PLATFORM_LABEL[platform]
  return [
    'Tap the photo above to open it full-size, then press and hold it to save it to your phone',
    `Open the ${app} app and start a new post`,
    'Add the photo you just saved',
    'Copy the caption below and paste it in',
    'Post it',
  ]
}

function DraftForm({ onClose, onSaved, tiktokConnected }) {
  const qc = useQueryClient()
  const [imageUrl, setImageUrl] = useState('')
  const [imagePath, setImagePath] = useState('') // storage path, if this image lives in our own bucket
  const [libraryId, setLibraryId] = useState('') // set if the image was picked from the Library, so we can mark it used
  const [scheduledDate, setScheduledDate] = useState('')
  const [enabled, setEnabled] = useState({ instagram: true, facebook: true, tiktok: false })
  const [activeTab, setActiveTab] = useState('instagram')
  const [captions, setCaptions] = useState({ instagram: '', facebook: '', tiktok: '' })
  const [generatingAll, setGeneratingAll] = useState(false)
  const [generatingOne, setGeneratingOne] = useState(false)
  const [autoPublishTiktok, setAutoPublishTiktok] = useState(false)
  const [tiktokPrivacyLevel, setTiktokPrivacyLevel] = useState('SELF_ONLY')
  const [tiktokIsAigc, setTiktokIsAigc] = useState(false)
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [genPrompt, setGenPrompt] = useState('')
  const [generating, setGenerating] = useState(false)
  const [libraryTab, setLibraryTab] = useState('unused')
  const [headerText, setHeaderText] = useState('')
  const [footerText, setFooterText] = useState('')
  const [applyingOverlay, setApplyingOverlay] = useState(false)
  const [aiHeaderIdeas, setAiHeaderIdeas] = useState([])
  const [aiFooterIdeas, setAiFooterIdeas] = useState([])
  const [loadingIdeas, setLoadingIdeas] = useState(false)

  // The photo library -- bulk-imported (or previously posted) photos, so
  // Shawn can pick from a running pool instead of hunting through Google
  // Photos each time. See migration 0071_media_library.sql.
  const { data: library } = useQuery({
    queryKey: ['mediaLibrary'],
    queryFn: async () => {
      const orgId = await fetchMyOrgId()
      const { data, error } = await supabase
        .from('media_library')
        .select('*')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },
  })
  const unusedPhotos = (library || []).filter((m) => m.status === 'unused')
  const usedPhotos = (library || []).filter((m) => m.status === 'used')

  const handleBulkImport = async (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    setImporting(true)
    setErr('')
    let ok = 0
    const failures = []
    try {
      const orgId = await fetchMyOrgId()
      for (const file of files) {
        try {
          const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
          const path = `${orgId}/media-library/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
          const { error: upErr } = await supabase.storage.from('card-assets').upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream' })
          if (upErr) throw upErr
          const { data } = supabase.storage.from('card-assets').getPublicUrl(path)
          const { error: insErr } = await supabase.from('media_library').insert({ org_id: orgId, url: data.publicUrl, storage_path: path, status: 'unused' })
          if (insErr) throw insErr
          ok++
        } catch (fileErr) {
          failures.push(`${file.name}: ${fileErr.message || 'failed'}`)
        }
      }
      qc.invalidateQueries({ queryKey: ['mediaLibrary'] })
      if (failures.length) {
        setErr(`Imported ${ok} of ${files.length}. Problems: ${failures.slice(0, 3).join('; ')}${failures.length > 3 ? ` (+${failures.length - 3} more)` : ''}`)
      }
    } catch (e2) {
      setErr(e2.message || 'Import failed before it could start.')
    } finally {
      setImporting(false)
    }
  }

  const pickFromLibrary = (item) => {
    setImageUrl(item.url)
    setImagePath(item.storage_path || '')
    setLibraryId(item.id)
  }

  // Bakes header/footer text straight into the photo's pixels (a dark
  // gradient band behind white text, top and/or bottom) using the browser's
  // own Canvas -- not AI, on purpose: an AI model asked to render text into
  // an image routinely misspells or garbles it, which is unacceptable for
  // something like a real phone number or price. Canvas draws the exact
  // characters typed, every time. Re-uploads the result as a new image
  // (same bucket/path convention as everything else here) so the result
  // works everywhere a normal photo does -- library, preview, TikTok, etc.
  const handleApplyOverlay = async () => {
    if (!imageUrl || (!headerText.trim() && !footerText.trim())) return
    setApplyingOverlay(true)
    setErr('')
    try {
      const img = new window.Image()
      img.crossOrigin = 'anonymous'
      await new Promise((resolve, reject) => {
        img.onload = resolve
        img.onerror = () => reject(new Error('Could not load the photo to add text to it.'))
        img.src = imageUrl
      })

      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0)

      const wrapText = (text, maxWidth, fontSize) => {
        ctx.font = `bold ${fontSize}px sans-serif`
        const words = text.split(' ')
        const lines = []
        let line = ''
        for (const word of words) {
          const test = line ? `${line} ${word}` : word
          if (line && ctx.measureText(test).width > maxWidth) {
            lines.push(line)
            line = word
          } else {
            line = test
          }
        }
        if (line) lines.push(line)
        return lines
      }

      const drawBand = (lines, fontSize, align) => {
        const lineHeight = fontSize * 1.3
        const padding = fontSize * 0.6
        const bandHeight = lines.length * lineHeight + padding * 2
        const bandY = align === 'top' ? 0 : canvas.height - bandHeight

        const gradient = ctx.createLinearGradient(0, bandY, 0, bandY + bandHeight)
        if (align === 'top') {
          gradient.addColorStop(0, 'rgba(0,0,0,.78)')
          gradient.addColorStop(1, 'rgba(0,0,0,0)')
        } else {
          gradient.addColorStop(0, 'rgba(0,0,0,0)')
          gradient.addColorStop(1, 'rgba(0,0,0,.78)')
        }
        ctx.fillStyle = gradient
        ctx.fillRect(0, bandY, canvas.width, bandHeight)

        ctx.fillStyle = '#ffffff'
        ctx.font = `bold ${fontSize}px sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        const textTop = align === 'top' ? padding * 0.5 : bandY + bandHeight - lines.length * lineHeight - padding * 0.3
        lines.forEach((line, i) => ctx.fillText(line, canvas.width / 2, textTop + i * lineHeight))
      }

      const maxTextWidth = canvas.width * 0.88
      if (headerText.trim()) {
        const fontSize = Math.round(canvas.width * 0.055)
        drawBand(wrapText(headerText.trim(), maxTextWidth, fontSize), fontSize, 'top')
      }
      if (footerText.trim()) {
        const fontSize = Math.round(canvas.width * 0.038)
        drawBand(wrapText(footerText.trim(), maxTextWidth, fontSize), fontSize, 'bottom')
      }

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
      if (!blob) throw new Error('Could not create the image with text on it.')

      const orgId = await fetchMyOrgId()
      const path = `${orgId}/social-posts/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`
      const { error: upErr } = await supabase.storage.from('card-assets').upload(path, blob, { upsert: false, contentType: 'image/jpeg' })
      if (upErr) throw upErr
      const { data } = supabase.storage.from('card-assets').getPublicUrl(path)
      setImageUrl(data.publicUrl)
      setImagePath(path)
      setLibraryId('')
    } catch (e2) {
      setErr(e2.message || 'Could not add text to the photo.')
    } finally {
      setApplyingOverlay(false)
    }
  }

  // Fresh header/footer ideas tailored to whatever's actually in this photo
  // (looks at it via Claude vision) -- a supplement to the 20 fixed presets
  // above for when those start feeling repetitive with a new vehicle.
  const handleGetAiIdeas = async () => {
    if (!imageUrl || loadingIdeas) return
    setLoadingIdeas(true)
    setErr('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/.netlify/functions/generate-photo-banners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
        body: JSON.stringify({ imageUrl }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not get ideas for this photo')
      setAiHeaderIdeas(data.headers || [])
      setAiFooterIdeas(data.footers || [])
    } catch (e2) {
      setErr(e2.message || 'Could not get ideas for this photo')
    } finally {
      setLoadingIdeas(false)
    }
  }

  // Voice input for the image description -- same browser SpeechRecognition
  // API AI Studio's chat and the Pipeline's Audio Brief field already use.
  // Only fills the field; talking never triggers Generate on its own.
  const [genListening, setGenListening] = useState(false)
  const genRecognitionRef = useRef(null)
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) return
    const rec = new SpeechRecognition()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = 'en-US'
    rec.onstart = () => setGenListening(true)
    rec.onend = () => setGenListening(false)
    rec.onerror = () => setGenListening(false)
    rec.onresult = (event) => {
      let finalText = ''
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) finalText += event.results[i][0].transcript + ' '
      }
      if (finalText) setGenPrompt((prev) => (prev ? prev.trim() + ' ' : '') + finalText.trim())
    }
    genRecognitionRef.current = rec
    return () => rec.stop()
  }, [])

  const toggleGenMic = () => {
    if (!genRecognitionRef.current) return
    if (genListening) genRecognitionRef.current.stop()
    else genRecognitionRef.current.start()
  }

  // Uploads straight from the phone/computer into the same public bucket
  // the business card logo already uses (card-assets) -- reuses its
  // existing "org members write under their own org_id folder, anyone can
  // read" storage policy, so no new bucket or Netlify function needed. A
  // public (not signed) URL matters here specifically because a scheduled
  // post might not auto-publish to TikTok for days -- a signed URL could
  // expire before then, a public one never does.
  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // let the same file be picked again later if needed
    if (!file) return
    setUploading(true)
    setErr('')
    try {
      const orgId = await fetchMyOrgId()
      const ext = file.name.split('.').pop() || 'jpg'
      const path = `${orgId}/social-posts/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { error: upErr } = await supabase.storage.from('card-assets').upload(path, file, { upsert: false, contentType: file.type })
      if (upErr) throw upErr
      const { data } = supabase.storage.from('card-assets').getPublicUrl(path)
      setImageUrl(data.publicUrl)
      setImagePath(path)
      setLibraryId('')
    } catch (e2) {
      setErr(e2.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  // AI-generated image (Gemini, via generate-social-image.js) -- a second
  // way to get an image in, alongside handleUpload above. Kept as its own
  // prompt field rather than reusing the caption, since what you'd want
  // to SEE in a photo (e.g. "a red Honda Acty truck on a car carrier at
  // sunset") is usually not the same words you'd want to READ in the caption.
  const handleGenerate = async () => {
    if (!genPrompt.trim() || generating) return
    setGenerating(true)
    setErr('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/.netlify/functions/generate-social-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
        body: JSON.stringify({ prompt: genPrompt.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Image generation failed')
      setImageUrl(data.imageUrl)
      setImagePath('') // generate-social-image.js already saved it under org/social-posts/... -- path not returned, and not needed since it's never re-picked from here
      setLibraryId('')
    } catch (e2) {
      setErr(e2.message || 'Image generation failed')
    } finally {
      setGenerating(false)
    }
  }

  const generateCaption = async (platform, seedText) => {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch('/.netlify/functions/generate-post-caption', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
      body: JSON.stringify({ platform, imageUrl: imageUrl || undefined, seedText: seedText || undefined }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || `Could not write the ${PLATFORM_LABEL[platform]} caption`)
    return data.caption
  }

  const handleGenerateAll = async () => {
    const targets = PLATFORMS.filter((p) => enabled[p])
    if (!targets.length) { setErr('Turn on at least one platform first.'); return }
    if (!imageUrl && !genPrompt.trim()) { setErr('Add a photo (or a quick note about the post) first, so there’s something to write about.'); return }
    setGeneratingAll(true)
    setErr('')
    try {
      const results = await Promise.all(targets.map((p) => generateCaption(p, genPrompt)))
      setCaptions((prev) => ({ ...prev, ...Object.fromEntries(targets.map((p, i) => [p, results[i]])) }))
    } catch (e2) {
      setErr(e2.message || 'Could not write the captions')
    } finally {
      setGeneratingAll(false)
    }
  }

  const handleRegenerateOne = async () => {
    setGeneratingOne(true)
    setErr('')
    try {
      const caption = await generateCaption(activeTab, captions[activeTab] || genPrompt)
      setCaptions((prev) => ({ ...prev, [activeTab]: caption }))
    } catch (e2) {
      setErr(e2.message || 'Could not write that caption')
    } finally {
      setGeneratingOne(false)
    }
  }

  const handleSave = async () => {
    const targets = PLATFORMS.filter((p) => enabled[p])
    if (!targets.length) { setErr('Turn on at least one platform first.'); return }
    if (targets.some((p) => !captions[p].trim())) { setErr('Every platform you’ve turned on needs caption text.'); return }
    if (!scheduledDate) { setErr('Scheduled date is required'); return }
    if (autoPublishTiktok && !imageUrl.trim()) { setErr('An image URL is required to auto-publish to TikTok'); return }

    setSaving(true)
    setErr('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      let firstPostId = null
      for (const platform of targets) {
        const res = await fetch('/.netlify/functions/social-posts-create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
          body: JSON.stringify({
            text: captions[platform],
            imageUrl: imageUrl || null,
            scheduledDate,
            platform,
            autoPublishTiktok: platform === 'tiktok' ? autoPublishTiktok : false,
            tiktokPrivacyLevel,
            tiktokIsAigc,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || `Failed to save the ${PLATFORM_LABEL[platform]} post`)
        if (!firstPostId) firstPostId = data.post?.id || null
      }

      // Keep the library honest: whatever photo just got used moves to
      // Posted, whether it came from the library or was fresh this time.
      if (imageUrl) {
        const orgId = await fetchMyOrgId()
        if (libraryId) {
          await supabase.from('media_library').update({ status: 'used', used_at: new Date().toISOString(), used_in_post_id: firstPostId }).eq('id', libraryId)
        } else {
          await supabase.from('media_library').insert({ org_id: orgId, url: imageUrl, storage_path: imagePath || null, status: 'used', used_at: new Date().toISOString(), used_in_post_id: firstPostId })
        }
        qc.invalidateQueries({ queryKey: ['mediaLibrary'] })
      }

      onSaved()
    } catch (e) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  const activeLibraryList = libraryTab === 'unused' ? unusedPhotos : usedPhotos

  return (
    <div className="mb-6 rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 className="text-sm font-semibold text-ink">Draft new post</h2>
        <p className="text-xs text-muted">Pick a photo, write it once, get it ready for every platform.</p>
      </div>
      {err && <p className="px-5 pt-3 text-xs text-port">{err}</p>}

      <div className="grid gap-4 p-5 lg:grid-cols-[240px_minmax(0,1fr)_280px]">

        {/* LEFT: Photo Library */}
        <div className="rounded-lg border border-line bg-canvas/40">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="text-xs font-semibold text-ink">Your Photo Library</span>
            <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-[10px] font-medium text-muted">{unusedPhotos.length} unused</span>
          </div>
          <div className="flex gap-1 p-2">
            <button
              type="button"
              onClick={() => setLibraryTab('unused')}
              className={`flex-1 rounded-md px-2 py-1.5 text-[11px] font-bold ${libraryTab === 'unused' ? 'bg-brand text-white' : 'bg-surface text-muted'}`}
            >
              UNUSED ({unusedPhotos.length})
            </button>
            <button
              type="button"
              onClick={() => setLibraryTab('used')}
              className={`flex-1 rounded-md px-2 py-1.5 text-[11px] font-bold ${libraryTab === 'used' ? 'bg-brand text-white' : 'bg-surface text-muted'}`}
            >
              POSTED ({usedPhotos.length})
            </button>
          </div>
          <div className="grid max-h-72 grid-cols-3 gap-1.5 overflow-y-auto p-2">
            {activeLibraryList.length === 0 && (
              <p className="col-span-3 py-4 text-center text-[11px] text-muted">
                {libraryTab === 'unused' ? 'No photos imported yet.' : 'Nothing posted from here yet.'}
              </p>
            )}
            {activeLibraryList.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => libraryTab === 'unused' && pickFromLibrary(item)}
                className={`relative aspect-square overflow-hidden rounded-md border-2 bg-cover bg-center ${libraryId === item.id ? 'border-accent' : 'border-transparent'}`}
                style={{ backgroundImage: `url(${item.url})` }}
                title={libraryTab === 'unused' ? 'Use this photo' : 'Already posted'}
              />
            ))}
          </div>
          <label className="m-2 block cursor-pointer rounded-md border border-dashed border-line bg-canvas px-2 py-2 text-center text-[11px] font-semibold text-muted hover:bg-canvas/70">
            {importing ? 'Importing…' : '⬆ Import photos from your phone'}
            <input type="file" accept="image/*" multiple onChange={handleBulkImport} disabled={importing} className="hidden" />
          </label>
        </div>

        {/* CENTER: editor */}
        <div className="rounded-lg border border-line">
          <div className="flex items-center gap-2 border-b border-line p-3">
            {imageUrl ? (
              <a href={imageUrl} target="_blank" rel="noopener noreferrer" title="Open full size">
                <img src={imageUrl} alt="" className="h-16 w-16 shrink-0 rounded-lg border border-line object-cover" />
              </a>
            ) : (
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-dashed border-line text-[10px] text-muted">no photo</div>
            )}
            <div className="flex-1 space-y-1.5">
              {imageUrl ? (
                // A real photo is attached (uploaded, from the Library, or
                // already AI-generated) -- hide the "make a new AI photo"
                // controls entirely so there's no way to accidentally
                // replace a real job photo with a generated one. This is
                // exactly the confusion Shawn hit: the old layout showed
                // both "Upload a photo" and "Generate photo" side by side
                // even after a real photo was already attached.
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-ink">✅ Photo attached</p>
                    <button
                      type="button"
                      onClick={() => { setImageUrl(''); setImagePath(''); setLibraryId(''); setHeaderText(''); setFooterText('') }}
                      className="text-[11px] font-semibold text-port hover:underline"
                    >
                      ✕ Remove
                    </button>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Header / footer text on the photo (optional)</p>
                    <button
                      type="button"
                      onClick={handleGetAiIdeas}
                      disabled={loadingIdeas}
                      className="shrink-0 text-[10px] font-semibold text-accent-600 hover:underline disabled:opacity-50"
                    >
                      {loadingIdeas ? 'Thinking…' : '✨ Get AI ideas for this photo'}
                    </button>
                  </div>

                  <select
                    defaultValue=""
                    onChange={(e) => { if (e.target.value) setHeaderText(e.target.value); e.target.value = '' }}
                    className="w-full rounded-md border border-line bg-canvas px-2 py-1 text-[11px] text-ink"
                  >
                    <option value="" disabled>💡 Pick a header idea…</option>
                    {aiHeaderIdeas.length > 0 && (
                      <optgroup label="✨ AI ideas for this photo">
                        {aiHeaderIdeas.map((h, i) => <option key={`aih-${i}`} value={h}>{h}</option>)}
                      </optgroup>
                    )}
                    <optgroup label="Presets">
                      {HEADER_IDEAS.map((h, i) => <option key={`h-${i}`} value={h}>{h}</option>)}
                    </optgroup>
                  </select>
                  <input
                    type="text"
                    value={headerText}
                    onChange={(e) => setHeaderText(e.target.value)}
                    placeholder="Header, e.g. 'PORT ESCORT AVAILABLE TODAY'"
                    disabled={applyingOverlay}
                    className="w-full rounded-md border border-line bg-canvas px-2 py-1 text-xs outline-none focus:border-accent"
                  />

                  <select
                    defaultValue=""
                    onChange={(e) => { if (e.target.value) setFooterText(e.target.value); e.target.value = '' }}
                    className="w-full rounded-md border border-line bg-canvas px-2 py-1 text-[11px] text-ink"
                  >
                    <option value="" disabled>💡 Pick a footer idea…</option>
                    {aiFooterIdeas.length > 0 && (
                      <optgroup label="✨ AI ideas for this photo">
                        {aiFooterIdeas.map((f, i) => <option key={`aif-${i}`} value={f}>{f}</option>)}
                      </optgroup>
                    )}
                    <optgroup label="Presets">
                      {FOOTER_IDEAS.map((f, i) => <option key={`f-${i}`} value={f}>{f}</option>)}
                    </optgroup>
                  </select>
                  <input
                    type="text"
                    value={footerText}
                    onChange={(e) => setFooterText(e.target.value)}
                    placeholder="Footer, e.g. '(310) 748-0040 · ship2shorebooking.com'"
                    disabled={applyingOverlay}
                    className="w-full rounded-md border border-line bg-canvas px-2 py-1 text-xs outline-none focus:border-accent"
                  />

                  <button
                    type="button"
                    onClick={handleApplyOverlay}
                    disabled={applyingOverlay || (!headerText.trim() && !footerText.trim())}
                    className="rounded-md border border-line bg-canvas px-2 py-1 text-[11px] font-semibold text-ink hover:bg-canvas/70 disabled:opacity-50"
                  >
                    {applyingOverlay ? 'Adding to photo…' : '🖋️ Add to photo'}
                  </button>
                </>
              ) : (
                <>
                  <label className="cursor-pointer text-xs font-semibold text-accent-600">
                    {uploading ? 'Uploading…' : '📷 Upload a photo'}
                    <input type="file" accept="image/*" onChange={handleUpload} disabled={uploading} className="hidden" />
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={genPrompt}
                      onChange={(e) => setGenPrompt(e.target.value)}
                      placeholder={genListening ? 'Listening…' : "…or describe a NEW photo for AI to create, e.g. 'a red Honda Acty on a car carrier at sunset'"}
                      disabled={generating}
                      className="flex-1 rounded-md border border-line bg-canvas px-2 py-1 text-xs outline-none focus:border-accent"
                    />
                    {(window.SpeechRecognition || window.webkitSpeechRecognition) && (
                      <button
                        type="button"
                        onClick={toggleGenMic}
                        disabled={generating}
                        title={genListening ? 'Stop listening' : 'Talk instead of typing'}
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-sm disabled:opacity-50 ${
                          genListening ? 'animate-pulse border-port bg-port/10 text-port' : 'border-line text-muted hover:text-ink'
                        }`}
                      >
                        🎤
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleGenerate}
                      disabled={generating || !genPrompt.trim()}
                      className="shrink-0 rounded-md border border-line bg-canvas px-2 py-1 text-[11px] font-semibold text-ink hover:bg-canvas/70 disabled:opacity-50"
                    >
                      {generating ? '…' : '✨ Generate a new photo with AI'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="flex gap-1.5 border-b border-line p-3">
            {PLATFORMS.map((p) => (
              <div key={p} className="flex-1">
                <button
                  type="button"
                  onClick={() => setActiveTab(p)}
                  className={`w-full rounded-t-md border px-2 py-1.5 text-xs font-bold ${
                    activeTab === p ? 'border-accent bg-accent text-ink' : 'border-line bg-canvas text-muted'
                  }`}
                >
                  {PLATFORM_LABEL[p]}
                </button>
                <label className="mt-1 flex items-center justify-center gap-1 text-[10px] text-muted">
                  <input type="checkbox" checked={enabled[p]} onChange={(e) => setEnabled((prev) => ({ ...prev, [p]: e.target.checked }))} />
                  include
                </label>
              </div>
            ))}
          </div>

          <div className="p-4">
            <button
              type="button"
              onClick={handleGenerateAll}
              disabled={generatingAll}
              className="mb-3 w-full rounded-lg bg-brand px-3 py-2.5 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50"
            >
              {generatingAll ? 'Writing captions…' : '✨ Generate & refine captions for every platform'}
            </button>

            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-muted">
              {PLATFORM_LABEL[activeTab]} caption {!enabled[activeTab] && '(not included)'}
            </p>
            <textarea
              value={captions[activeTab]}
              onChange={(e) => setCaptions((prev) => ({ ...prev, [activeTab]: e.target.value }))}
              placeholder={`Write it yourself, or use "Generate" above…`}
              rows={7}
              className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm leading-relaxed outline-none focus:border-accent"
            />
            <div className="mt-2 rounded-lg border border-line bg-canvas/60 p-2.5 text-[11px] leading-relaxed text-muted">
              📎 {LINK_NOTE[activeTab]}
            </div>
            <button
              type="button"
              onClick={handleRegenerateOne}
              disabled={generatingOne}
              className="mt-2 rounded-md border border-line bg-surface px-2.5 py-1.5 text-[11px] font-semibold text-ink hover:bg-canvas/70 disabled:opacity-50"
            >
              {generatingOne ? 'Rewriting…' : `🔄 Rewrite just ${PLATFORM_LABEL[activeTab]}`}
            </button>

            {activeTab === 'tiktok' && (
              <div className="mt-3 rounded-lg border border-line bg-canvas/50 p-3">
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
            )}
          </div>
        </div>

        {/* RIGHT: preview + how-to + schedule */}
        <div className="rounded-lg border border-line">
          <p className="border-b border-line px-3 py-2 text-xs font-semibold text-ink">Preview — {PLATFORM_LABEL[activeTab]}</p>
          <div className="flex justify-center p-3">
            <div className="w-full max-w-[200px] overflow-hidden rounded-2xl border-[6px] border-brand bg-white shadow-[var(--shadow-card)]">
              <div className="flex items-center gap-1.5 border-b border-line/50 px-2 py-1.5">
                <div className="h-4 w-4 rounded-full bg-gradient-to-br from-accent to-ink" />
                <b className="text-[9px] text-ink">ship2shorebooking</b>
              </div>
              {imageUrl ? (
                <img src={imageUrl} alt="" className="aspect-[4/5] w-full object-cover" />
              ) : (
                <div className="flex aspect-[4/5] w-full items-center justify-center bg-canvas text-[10px] text-muted">no photo yet</div>
              )}
              <p className="px-2 py-1.5 text-[9px] leading-snug text-ink/80">
                <b>ship2shorebooking</b> {(captions[activeTab] || 'Your caption will show here…').slice(0, 90)}{captions[activeTab]?.length > 90 ? '…' : ''}
              </p>
            </div>
          </div>

          <div className="mx-3 mb-3 rounded-lg border border-line bg-canvas/60 p-3">
            <p className="mb-1.5 text-[11px] font-bold text-ink">📱 How to actually post this</p>
            <ol className="ml-4 list-decimal space-y-1 text-[11px] leading-relaxed text-ink/80">
              {howToSteps(activeTab, autoPublishTiktok).map((step, i) => <li key={i}>{step}</li>)}
            </ol>
          </div>

          <p className="border-y border-line px-3 py-2 text-xs font-semibold text-ink">Scheduled date &amp; time</p>
          <div className="p-3">
            <input
              type="datetime-local"
              value={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
              className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
        <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted hover:bg-canvas hover:text-ink">
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-ink hover:bg-accent-600 disabled:opacity-50"
        >
          {saving ? 'Saving…' : `Save draft${PLATFORMS.filter((p) => enabled[p]).length > 1 ? 's' : ''}`}
        </button>
      </div>
    </div>
  )
}
