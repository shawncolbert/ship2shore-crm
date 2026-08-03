import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

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

  if (isLoading) return <div className="flex min-h-screen items-center justify-center bg-canvas">Loading…</div>
  if (error || !funnel) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <div className="text-center">
          <p className="text-lg font-semibold text-ink">Funnel not found</p>
          <p className="text-sm text-muted">This funnel may have been removed or is not yet published.</p>
        </div>
      </div>
    )
  }

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
      <div className="flex min-h-screen items-center justify-center bg-canvas p-4">
        <div className="max-w-md text-center">
          <div className="mb-4 text-4xl">✓</div>
          <h1 className="text-2xl font-bold text-ink">Thanks!</h1>
          <p className="mt-2 text-sm text-muted">We've received your information and will be in touch shortly.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-md rounded-xl border border-line bg-surface p-6">
        <h1 className="text-2xl font-bold text-ink">{funnel.name}</h1>
        {funnel.description && <p className="mt-1 text-sm text-muted">{funnel.description}</p>}

        {/* Progress */}
        <div className="mt-4 flex gap-2">
          {funnel.steps?.map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full ${
                i <= currentStep ? 'bg-accent' : 'bg-line'
              }`}
            />
          ))}
        </div>

        {/* Step */}
        {step && (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-ink">{step.title}</h2>
              {step.description && <p className="mt-1 text-xs text-muted">{step.description}</p>}
            </div>

            {/* Simple fields - just show key input fields for demo */}
            {['full_name', 'email', 'phone', 'service_type', 'budget'].map((field) => (
              <div key={field}>
                <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
                  {field.replace(/_/g, ' ')}
                </label>
                <input
                  type={field === 'email' ? 'email' : 'text'}
                  value={formData[field] || ''}
                  onChange={(e) => setFormData({ ...formData, [field]: e.target.value })}
                  required={['full_name', 'email'].includes(field)}
                  className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-accent"
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
                  className="flex-1 rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink hover:bg-canvas"
                >
                  Back
                </button>
              )}
              <button
                type={isLastStep ? 'submit' : 'button'}
                onClick={() => !isLastStep && setCurrentStep(currentStep + 1)}
                disabled={submitting}
                className="flex-1 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-ink hover:bg-accent-600 disabled:opacity-50"
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
