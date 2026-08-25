import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { chatAiStudio, fetchMyOrg, fetchMyProfile } from '../lib/supabase'
import { fetchOrgs, aiStudioList, aiStudioGet, aiStudioSave } from '../lib/admin'
import BusinessCardView from '../components/businessCard/BusinessCardView'

const KINDS = [
  { value: 'landing_page', label: 'Landing Page' },
  { value: 'business_card', label: 'Business Card' },
]

function landingPagePreviewDoc(html) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0">${html || ''}</body></html>`
}

export default function AiStudio() {
  const qc = useQueryClient()
  const { data: profile, isLoading: profileLoading } = useQuery({ queryKey: ['myProfile'], queryFn: fetchMyProfile })
  const { data: myOrg } = useQuery({ queryKey: ['myOrg'], queryFn: fetchMyOrg })
  // Platform-admin only, and works against any org -- this is how a
  // brand-new client's landing page and business card get pre-built
  // before the org is even handed over, not just Shawn's own.
  const { data: orgs } = useQuery({ queryKey: ['adminOrgs'], queryFn: fetchOrgs, enabled: !!profile?.platform_admin })

  const [orgId, setOrgId] = useState('')
  useEffect(() => { if (!orgId && myOrg?.id) setOrgId(myOrg.id) }, [orgId, myOrg])

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

  // Voice input -- same browser SpeechRecognition API the Pipeline's Audio
  // Brief field already uses, entirely client-side. It only fills the
  // textarea; talking never sends anything on its own, same "AI suggests,
  // human confirms" send step as typing.
  const [listening, setListening] = useState(false)
  const recognitionRef = useRef(null)
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) return
    const rec = new SpeechRecognition()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = 'en-US'
    rec.onstart = () => setListening(true)
    rec.onend = () => setListening(false)
    rec.onerror = () => setListening(false)
    rec.onresult = (event) => {
      let finalText = ''
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) finalText += event.results[i][0].transcript + ' '
      }
      if (finalText) setInput((prev) => (prev ? prev.trim() + ' ' : '') + finalText.trim())
    }
    recognitionRef.current = rec
    return () => rec.stop()
  }, [])

  const toggleMic = () => {
    if (!recognitionRef.current) return
    if (listening) recognitionRef.current.stop()
    else recognitionRef.current.start()
  }

  const { data: existingList } = useQuery({
    queryKey: ['aiStudioList', orgId, kind],
    queryFn: () => aiStudioList({ orgId, kind }),
    enabled: !!orgId,
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
      const page = await aiStudioGet({ orgId, kind, id })
      if (kind === 'landing_page') {
        const html = page.blocks?.find((b) => b.type === 'custom_html')?.html || ''
        setContent({ slug: page.slug, title: page.title, meta_description: page.meta_description || '', schema_json: page.schema_json || '', html })
        setMessages([{ role: 'assistant', content: `Loaded "${page.title}" (/pages/${page.slug}). Tell me what to change.` }])
      } else {
        setContent(page)
        setMessages([{ role: 'assistant', content: `Loaded the "${page.brand_name || page.full_name || 'untitled'}" card. Tell me what to change.` }])
      }
    } catch (e) {
      setError(e.message || 'Could not load that.')
    }
  }

  const changeOrg = (id) => {
    setOrgId(id)
    startNew()
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
      const res = await chatAiStudio({ kind, orgId, messages: nextMessages, currentContent: content })
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
    if (!content || !orgId) return
    setSaving(true)
    setError('')
    try {
      const result = await aiStudioSave({ orgId, kind, id: targetId || null, content })
      setTargetId(result.id)
      await qc.invalidateQueries({ queryKey: ['aiStudioList', orgId, kind] })
      setSavedInfo({ url: kind === 'landing_page' ? `/pages/${result.slug}` : `/card/${result.slug || ''}` })
    } catch (e) {
      setError(e.message || 'Could not save.')
    } finally {
      setSaving(false)
    }
  }

  if (!profileLoading && !profile?.platform_admin) {
    return (
      <div className="p-6 text-sm text-gray-500">AI Studio isn't enabled for this account.</div>
    )
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">AI Studio</h1>
        <p className="mt-1 text-sm text-gray-500">
          Describe what you want in plain language. Nothing saves until you hit Save on a draft you like.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {orgs && orgs.length > 1 && (
          <select
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900"
            value={orgId}
            onChange={(e) => changeOrg(e.target.value)}
          >
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>{o.name}{o.id === myOrg?.id ? ' (mine)' : ''}</option>
            ))}
          </select>
        )}

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
          {(existingList || []).map((item) => (
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
              placeholder={listening ? 'Listening…' : 'Tell it what you want…'}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
            />
            {(window.SpeechRecognition || window.webkitSpeechRecognition) && (
              <button
                type="button"
                onClick={toggleMic}
                title={listening ? 'Stop listening' : 'Talk instead of typing'}
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-base ${
                  listening
                    ? 'animate-pulse border-red-300 bg-red-50 text-red-600'
                    : 'border-gray-200 text-gray-500 hover:text-gray-900'
                }`}
              >
                🎤
              </button>
            )}
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
