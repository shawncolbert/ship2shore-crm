import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getPublicTheme } from '../lib/publicThemes'

export default function PublicFunnel() {
  const { slug } = useParams()
  const [currentStep, setCurrentStep] = useState(0)
  const [formData, setFormData] = useState({})
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const { data: funnel, isLoading, error } = useQuery({
    queryKey: ['publicFunnel', slug],
    queryFn: async () => {
      const res = await fetch(`/.netlify/functions/funnel-public?slug=${slug}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Funnel not found')
      return data.funnel
    },
  })

  if (isLoading) return <div className="flex min-h-screen items-center justify-center bg-gray-50">Loading…</div>
  if (error || !funnel) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-lg font-semibold text-gray-900">Funnel not found</p>
          <p className="text-sm text-gray-500">This funnel may have been removed or is not yet published.</p>
        </div>
      </div>
    )
  }

  const { accent, accentText } = getPublicTheme(funnel.theme)
  const step = funnel.steps?.[currentStep]
  const isLastStep = currentStep === funnel.steps.length - 1

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      const res = await fetch('/.netlify/functions/funnel-submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ funnelId: funnel.id, data: formData }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Submission failed')
      setSubmitted(true)
    } catch (err) {
      alert(`Error: ${err.message}`)
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
        <div className="max-w-md text-center">
          <div className="mb-4 text-4xl">✓</div>
          <h1 className="text-2xl font-bold text-gray-900">Thanks!</h1>
          <p className="mt-2 text-sm text-gray-500">We've received your information and will be in touch shortly.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6">
        <h1 className="text-2xl font-bold text-gray-900">{funnel.name}</h1>
        {funnel.description && <p className="mt-1 text-sm text-gray-500">{funnel.description}</p>}

        {/* Progress */}
        <div className="mt-4 flex gap-2">
          {funnel.steps?.map((_, i) => (
            <div
              key={i}
              className="h-1 flex-1 rounded-full"
              style={{ background: i <= currentStep ? accent : '#e5e7eb' }}
            />
          ))}
        </div>

        {/* Step */}
        {step && (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{step.title}</h2>
              {step.description && <p className="mt-1 text-xs text-gray-500">{step.description}</p>}
            </div>

            {/* Render fields defined in the step */}
            {step.fields?.map((field) => (
              <div key={field}>
                <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {field.replace(/_/g, ' ')}
                </label>
                <input
                  type={field === 'email' ? 'email' : 'text'}
                  value={formData[field] || ''}
                  onChange={(e) => setFormData({ ...formData, [field]: e.target.value })}
                  required={['full_name', 'email'].includes(field)}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none"
                  placeholder={field.replace(/_/g, ' ')}
                />
              </div>
            ))}

            {/* Navigation */}
            <div className="mt-6 flex gap-2">
              {currentStep > 0 && (
                <button
                  type="button"
                  onClick={() => setCurrentStep(currentStep - 1)}
                  className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50"
                >
                  Back
                </button>
              )}
              <button
                type={isLastStep ? 'submit' : 'button'}
                onClick={() => !isLastStep && setCurrentStep(currentStep + 1)}
                disabled={submitting}
                style={{ background: accent, color: accentText }}
                className="flex-1 rounded-lg px-4 py-2 text-sm font-semibold hover:brightness-95 disabled:opacity-50"
              >
                {isLastStep ? (submitting ? 'Submitting…' : 'Submit') : 'Next'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
