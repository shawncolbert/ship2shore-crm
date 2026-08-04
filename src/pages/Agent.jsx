import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export default function Agent() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Hi! I\'m your CRM assistant. I can help you create contacts, manage deals, search your pipeline, and more. What can I do for you?' },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [conversationHistory, setConversationHistory] = useState([])
  const [listening, setListening] = useState(false)
  const messagesEndRef = useRef(null)
  const recognitionRef = useRef(null)

  // Initialize speech recognition
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition()
      recognitionRef.current.continuous = false
      recognitionRef.current.interimResults = true
      recognitionRef.current.lang = 'en-US'

      recognitionRef.current.onstart = () => setListening(true)
      recognitionRef.current.onend = () => setListening(false)
      recognitionRef.current.onresult = (event) => {
        let transcript = ''
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript
        }
        if (event.results[event.results.length - 1].isFinal) {
          setInput(transcript)
        }
      }
      recognitionRef.current.onerror = (event) => {
        console.error('Speech recognition error:', event.error)
        setListening(false)
      }
    }
  }, [])

  const toggleMic = () => {
    if (!recognitionRef.current) {
      alert('Speech recognition not supported in your browser')
      return
    }

    if (listening) {
      recognitionRef.current.stop()
    } else {
      setInput('')
      recognitionRef.current.start()
    }
  }

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSend = async () => {
    if (!input.trim() || loading) return

    const userMessage = input
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }])
    setLoading(true)

    try {
      const { data: { session } } = await supabase.auth.getSession()

      const res = await fetch('/.netlify/functions/agent-controller', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token || ''}`,
        },
        body: JSON.stringify({
          userPrompt: userMessage,
          conversationHistory,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${data.error}` }])
        return
      }

      // Add assistant response
      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }])

      // Update conversation history for next turn
      setConversationHistory(data.conversationHistory || [])

      // Handle client events (navigate, refresh, etc)
      if (data.clientEvents?.length) {
        for (const event of data.clientEvents) {
          if (event.type === 'REDIRECT') {
            navigate(event.route)
          } else if (
            event.type === 'CONTACT_ADDED' ||
            event.type === 'CONTACT_UPDATED' ||
            event.type === 'OPPORTUNITY_ADDED' ||
            event.type === 'OPPORTUNITY_UPDATED' ||
            event.type === 'OPPORTUNITY_DELETED' ||
            event.type === 'CONTACT_DELETED'
          ) {
            // Refresh relevant queries
            qc.invalidateQueries({ queryKey: ['contacts'] })
            qc.invalidateQueries({ queryKey: ['opportunities'] })
            qc.invalidateQueries({ queryKey: ['pipeline'] })
          }
        }
      }
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${err.message}` }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-full flex-col bg-canvas">
      {/* Header */}
      <div className="border-b border-line bg-surface px-3 py-3 sm:px-6 sm:py-4">
        <h1 className="font-[family-name:var(--font-display)] text-lg sm:text-2xl font-bold text-ink">CRM Assistant</h1>
        <p className="mt-1 text-xs sm:text-sm text-muted">AI-powered sales automation. Manage deals, contacts, pipeline.</p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-3 sm:px-6 sm:space-y-4">
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-xs sm:max-w-md rounded-lg px-3 py-2 sm:px-4 sm:py-2 ${
                msg.role === 'user'
                  ? 'bg-accent text-ink'
                  : 'bg-surface border border-line text-ink'
              }`}
            >
              <p className="text-xs sm:text-sm leading-relaxed break-words">{msg.content}</p>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-surface border border-line text-ink rounded-lg px-3 py-2 sm:px-4 sm:py-2">
              <p className="text-xs sm:text-sm text-muted">Thinking…</p>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-line bg-surface px-3 py-3 sm:px-6 sm:py-4">
        <div className="flex gap-2 flex-col sm:flex-row">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSend()}
            placeholder={listening ? 'Listening...' : "Ask me anything..."}
            disabled={loading}
            className="flex-1 rounded-lg border border-line bg-canvas px-3 py-2.5 sm:py-2 text-sm outline-none focus:border-accent disabled:opacity-50"
          />
          <div className="flex gap-2">
            <button
              onClick={toggleMic}
              disabled={loading}
              className={`rounded-lg px-3 sm:px-4 py-2.5 sm:py-2 text-base sm:text-sm font-semibold transition-colors ${
                listening
                  ? 'bg-red-500 text-white hover:bg-red-600 active:bg-red-700'
                  : 'bg-slate-600 text-white hover:bg-slate-700 active:bg-slate-800'
              } disabled:opacity-50 flex-shrink-0`}
              title="Click to speak"
            >
              🎤
            </button>
            <button
              onClick={handleSend}
              disabled={loading || !input.trim()}
              className="rounded-lg bg-accent px-3 sm:px-4 py-2.5 sm:py-2 text-sm font-semibold text-ink hover:bg-accent-600 active:bg-accent-700 disabled:opacity-50 flex-shrink-0 transition-colors"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
