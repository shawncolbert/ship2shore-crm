import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchLandingPages, fetchLandingPage, createLandingPage, updateLandingPage,
  chatAiStudio, fetchMyOrg, fetchMyOrgId,
} from '../lib/supabase'
import { fetchMyBusinessCards, createBusinessCard, saveBusinessCard } from '../lib/businessCard'
import BusinessCardView from '../components/businessCard/BusinessCardView'

// Scoped to Ship2Shore's own org only -- matches the same constant the
// backend function enforces. This is a UI convenience (hide the page and
// nav link); the real gate is server-side, since this calls a paid API.
const AI_STUDIO_ORG_ID = '11111111-1111-1111-1111-111111111111'

const KINDS = [
  { value: 'landing_page', label: 'Landing Page' },
  { value: 'business_card', label: 'Business Card' },
]

function landingPagePreviewDoc(html) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0">${html || ''}</body></html>`
}

export default function AiStudio() {
  const qc = useQueryClient()
  const { data: org } = useQuery({ queryKey: ['myOrg'], queryFn: fetchMyOrg })

  const [kind, setKind] = useState('landing_page')
  const [targetId, setTargetId] = useState('') // '' = new
  const [messages, setMessages] = useState([])
  const [content, setContent] = useState(null)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedInfo, setSavedInfo] = useState(null)
  const bottomRef = useRef(null)

  const { data: landingPages } = useQuery({
    queryKey: ['landingPages'], queryFn: fetchLandingPages, enabled: kind === 'landing_page',
  })
  const { data: businessCards } = useQuery({
    queryKey: ['myBusinessCards'], queryFn: fetchMyBusinessCards, enabled: kind === 'business_card',
  })

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, content])

  const resetConversation = () => {
    setMessages([])
    setContent(null)
    setError('')
    setSavedInfo(null)
  }

  const startNew = () => {
    setTargetId('')
    resetConversation()
  }

  const loadExisting = async (id) => {
    setTargetId(id)
    resetConversation()
    if (!id) return
    try {
      if (kind === 'landing_page') {
        const page = await fetchLandingPage(id)
        const html = page.blocks?.find((b) => b.type === 'custom_html')?.html || ''
        setContent({ slug: page.slug, title: page.title, meta_description: page.meta_description || '', schema_json: page.schema_json || '', html })
        setMessages([{ role: 'assistant', content: `Loaded "${page.title}" (/pages/${page.slug}). Tell me what to change.` }])
      } else {
        const card = (businessCards || []).find((c) => c.id === id)
        if (card) {
          setContent(card)
          setMessages([{ role: 'assistant', content: `Loaded the "${card.brand_name || card.full_name || 'untitled'}" card. Tell me what to change.` }])
        }
      }
    } catch (e) {
      setError(e.message || 'Could not load that.')
    }
  }

  const send = async () => {
    const text = input.trim()
    if (!text || sending) return
    setInput('')
    setError('')
    const nextMessages = [...messages, { role: 'user', content: text }]
    setMessages(nextMessages)
    setSending(true)
    try {
      const res = await chatAiStudio({ kind, messages: nextMessages, currentContent: content })
      setMessages((m) => [...m, { role: 'assistant', content: res.reply }])
      if (res.content) setContent(res.content)
    } catch (e) {
      setError(e.message || 'Something went wrong.')
    } finally {
      setSending(false)
    }
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  const save = async () => {
    if (!content) return
    setSaving(true)
    setError('')
    try {
      if (kind === 'landing_page') {
        const blocks = [{ id: crypto.randomUUID(), type: 'custom_html', html: content.html }]
        if (targetId) {
          await updateLandingPage(targetId, {
            slug: content.slug, title: content.title, meta_description: content.meta_description,
            schema_json: content.schema_json, blocks,
          })
        } else {
          const created = await createLandingPage({
            slug: content.slug, title: content.title, published: true, theme: 'classic', blocks,
            meta_description: content.meta_description, schema_json: content.schema_json,
          })
          setTargetId(created.id)
        }
        await qc.invalidateQueries({ queryKey: ['landingPages'] })
        setSavedInfo({ url: `/pages/${content.slug}` })
      } else {
        if (targetId) {
          await saveBusinessCard(targetId, content)
        } else {
          const orgId = await fetchMyOrgId()
          const created = await createBusinessCard(orgId, content)
          setTargetId(created.id)
        }
        await qc.invalidateQueries({ queryKey: ['myBusinessCards'] })
        setSavedInfo({ url: `/card/${content.slug || ''}` })
      }
    } catch (e) {
      setError(e.message || 'Could not save.')
    } finally {
      setSaving(false)
    }
  }

  if (org && org.id !== AI_STUDIO_ORG_ID) {
    return (
      <div className="p-6 text-sm text-gray-500">AI Studio isn't enabled for this organization.</div>
    )
  }

  const existingList = kind === 'landing_page'
    ? (landingPages || []).map((p) => ({ id: p.id, label: p.title || p.slug }))
    : (businessCards || []).map((c) => ({ id: c.id, label: c.brand_name || c.full_name || 'Untitled card' }))

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">AI Studio</h1>
        <p className="mt-1 text-sm text-gray-500">
          Describe what you want in plain language. Nothing saves until you hit Save on a draft you like.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-gray-200 bg-white p-1">
          {KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              onClick={() => { setKind(k.value); startNew() }}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
                kind === k.value ? 'bg-gray-900 text-white' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>

        <select
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900"
          value={targetId}
          onChange={(e) => (e.target.value ? loadExisting(e.target.value) : startNew())}
        >
          <option value="">+ Start a new one</option>
          {existingList.map((item) => (
            <option key={item.id} value={item.id}>Edit: {item.label}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Chat */}
        <div className="flex h-[560px] flex-col rounded-2xl border border-gray-200 bg-white">
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 && (
              <p className="text-sm text-gray-400">
                {kind === 'landing_page'
                  ? 'Try: "Build a page for military PCS moves, same style as the port page."'
                  : 'Try: "Set up a card for my driver Fernando, Extreme Transport, navy and orange."'}
              </p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                  m.role === 'user' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-800'
                }`}>
                  {m.content}
                </div>
              </div>
            ))}
            {sending && <div className="text-sm text-gray-400">Thinking…</div>}
            {error && <div className="text-sm font-medium text-red-500">{error}</div>}
            <div ref={bottomRef} />
          </div>
          <div className="flex items-end gap-2 border-t border-gray-100 p-3">
            <textarea
              rows={2}
              className="flex-1 resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-400"
              placeholder="Tell it what you want…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <button
              type="button"
              onClick={send}
              disabled={sending || !input.trim()}
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              Send
            </button>
          </div>
        </div>

        {/* Preview */}
        <div className="flex h-[560px] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <span className="text-sm font-semibold text-gray-700">
              {content ? 'Live preview' : 'No draft yet'}
            </span>
            {content && (
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
              >
                {saving ? 'Saving…' : targetId ? 'Save changes' : 'Save as new'}
              </button>
            )}
          </div>

          {!content && (
            <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-gray-400">
              The draft shows up here once there's enough to preview.
            </div>
          )}

          {content && kind === 'landing_page' && (
            <div className="flex-1 overflow-hidden">
              <iframe
                title="Landing page preview"
                className="h-full w-full"
                srcDoc={landingPagePreviewDoc(content.html)}
              />
            </div>
          )}

          {content && kind === 'business_card' && (
            <div className="flex-1 overflow-y-auto bg-gray-50 p-4">
              <BusinessCardView card={{ slug: content.slug || '', ...content }} mode="preview" />
            </div>
          )}

          {savedInfo && (
            <div className="border-t border-gray-100 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
              Saved — <a href={savedInfo.url} target="_blank" rel="noopener noreferrer" className="font-semibold underline">{savedInfo.url}</a>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
