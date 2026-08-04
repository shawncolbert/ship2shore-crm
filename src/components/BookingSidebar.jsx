import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, fetchServices, fetchContacts } from '../lib/supabase'

const SERVICES = {
  twic_escort: { name: 'TWIC Vehicle Escort', base: 95, military: 80 },
  hotshot: { name: 'Hotshot Delivery', flat: 200 },
  semi_container: { name: 'Semi/Container', flat: 325 },
}

const ZONES = {
  'LA Local': { min: 275, max: 325 },
  'Orange County': { min: 300, max: 350 },
  'Ventura County': { min: 325, max: 375 },
  'Valencia/Santa Clarita': { min: 350, max: 400 },
  'Riverside/San Bernardino': { min: 400, max: 475 },
  'San Diego': { min: 600, max: 675 },
  'Northern CA': { min: 625, max: 725 },
}

const SURCHARGES = {
  'non-operating': 200,
  'winching': 125,
  'oversized': 125,
  'lifted': 150,
}

export default function BookingSidebar({ open, onClose }) {
  const qc = useQueryClient()
  const [serviceType, setServiceType] = useState('twic_escort')
  const [selectedContact, setSelectedContact] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [zone, setZone] = useState('LA Local')
  const [isMilitary, setIsMilitary] = useState(false)
  const [selectedSurcharges, setSelectedSurcharges] = useState([])
  const [lineItems, setLineItems] = useState([])
  const [newContactName, setNewContactName] = useState('')
  const [newContactEmail, setNewContactEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const { data: contacts = [] } = useQuery({
    queryKey: ['contacts'],
    queryFn: () => fetchContacts(),
    enabled: open,
  })

  const filteredContacts = contacts.filter(c =>
    c.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.email?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const calculateItemTotal = () => {
    const service = SERVICES[serviceType]
    if (!service) return 0

    let basePrice = 0
    if (serviceType === 'twic_escort') {
      basePrice = (isMilitary ? service.military : service.base) * quantity
    } else if (serviceType === 'hotshot') {
      basePrice = service.flat * quantity
    } else if (serviceType === 'semi_container') {
      basePrice = service.flat * quantity
    }

    const surchargeTotal = selectedSurcharges.reduce(
      (sum, s) => sum + (SURCHARGES[s] || 0),
      0
    )

    return basePrice + surchargeTotal
  }

  const addLineItem = () => {
    const service = SERVICES[serviceType]
    if (!service) {
      setError('Please select a service')
      return
    }

    const total = calculateItemTotal()

    const item = {
      id: Date.now(),
      serviceType,
      serviceName: service.name,
      quantity,
      zone,
      isMilitary,
      surcharges: [...selectedSurcharges],
      total,
    }

    setLineItems([...lineItems, item])
    setSelectedSurcharges([])
    setQuantity(1)
    setError('')
  }

  const removeLineItem = (id) => {
    setLineItems(lineItems.filter(item => item.id !== id))
  }

  const getGrandTotal = () => {
    return lineItems.reduce((sum, item) => sum + item.total, 0)
  }

  const handleCreateBooking = async () => {
    if (!selectedContact && !newContactName) {
      setError('Please select or create a customer')
      return
    }

    if (lineItems.length === 0) {
      setError('Please add at least one service')
      return
    }

    setLoading(true)
    setError('')

    try {
      // Create booking via AI agent
      const prompt = `Create a new booking with these details:
Customer: ${selectedContact?.full_name || newContactName}
Email: ${selectedContact?.email || newContactEmail}
Services: ${lineItems.map(item => `${item.quantity}x ${item.serviceName}`).join(', ')}
Total Value: $${getGrandTotal()}
Zone: ${zone}

Create the contact if needed and add to pipeline with total value $${getGrandTotal()}.`

      const { data: { session } } = await supabase.auth.getSession()

      const res = await fetch('/.netlify/functions/agent-controller', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token || ''}`,
        },
        body: JSON.stringify({
          userPrompt: prompt,
          conversationHistory: [],
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(`Failed to create booking: ${data.error}`)
        return
      }

      // Refresh relevant queries
      qc.invalidateQueries({ queryKey: ['contacts'] })
      qc.invalidateQueries({ queryKey: ['opportunities'] })
      qc.invalidateQueries({ queryKey: ['pipeline'] })

      // Reset form
      setServiceType('twic_escort')
      setSelectedContact(null)
      setSearchQuery('')
      setQuantity(1)
      setZone('LA Local')
      setIsMilitary(false)
      setSelectedSurcharges([])
      setLineItems([])
      setNewContactName('')
      setNewContactEmail('')

      alert('✓ Booking created and added to pipeline!')
      onClose()
    } catch (err) {
      setError(`Error: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-surface border-l border-line shadow-xl overflow-y-auto z-40">
      {/* Header */}
      <div className="sticky top-0 bg-surface border-b border-line px-6 py-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-ink">Create Booking</h2>
        <button
          onClick={onClose}
          className="text-muted hover:text-ink rounded p-1"
        >
          ✕
        </button>
      </div>

      {/* Content */}
      <div className="p-6 space-y-6">
        {error && (
          <div className="bg-red-100 border border-red-300 text-red-800 px-4 py-2 rounded text-sm">
            {error}
          </div>
        )}

        {/* Customer Selection */}
        <div>
          <label className="block text-sm font-semibold text-ink mb-2">Customer</label>
          {selectedContact ? (
            <div className="bg-accent bg-opacity-20 px-3 py-2 rounded border border-accent mb-2 flex items-center justify-between">
              <div>
                <p className="font-medium text-ink">{selectedContact.full_name}</p>
                <p className="text-xs text-muted">{selectedContact.email}</p>
              </div>
              <button
                onClick={() => setSelectedContact(null)}
                className="text-muted hover:text-ink"
              >
                ✕
              </button>
            </div>
          ) : (
            <>
              <input
                type="text"
                placeholder="Search existing customer..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full border border-line rounded px-3 py-2 text-sm mb-2 bg-canvas"
              />
              {searchQuery && filteredContacts.length > 0 && (
                <div className="border border-line rounded bg-canvas max-h-40 overflow-y-auto mb-2">
                  {filteredContacts.map((contact) => (
                    <button
                      key={contact.id}
                      onClick={() => {
                        setSelectedContact(contact)
                        setSearchQuery('')
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-accent hover:bg-opacity-10 border-b border-line last:border-b-0 text-sm"
                    >
                      <p className="font-medium text-ink">{contact.full_name}</p>
                      <p className="text-xs text-muted">{contact.email}</p>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {!selectedContact && (
            <>
              <p className="text-xs text-muted my-2">Or create new:</p>
              <input
                type="text"
                placeholder="Customer name"
                value={newContactName}
                onChange={(e) => setNewContactName(e.target.value)}
                className="w-full border border-line rounded px-3 py-2 text-sm mb-2 bg-canvas"
              />
              <input
                type="email"
                placeholder="Email"
                value={newContactEmail}
                onChange={(e) => setNewContactEmail(e.target.value)}
                className="w-full border border-line rounded px-3 py-2 text-sm bg-canvas"
              />
            </>
          )}
        </div>

        {/* Service Selection */}
        <div>
          <label className="block text-sm font-semibold text-ink mb-2">Service Type</label>
          <select
            value={serviceType}
            onChange={(e) => setServiceType(e.target.value)}
            className="w-full border border-line rounded px-3 py-2 text-sm bg-canvas"
          >
            {Object.entries(SERVICES).map(([key, service]) => (
              <option key={key} value={key}>
                {service.name}
              </option>
            ))}
          </select>
        </div>

        {/* Quantity */}
        <div>
          <label className="block text-sm font-semibold text-ink mb-2">
            Quantity {serviceType === 'twic_escort' && '(# of vehicles)'}
          </label>
          <input
            type="number"
            min="1"
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
            className="w-full border border-line rounded px-3 py-2 text-sm bg-canvas"
          />
        </div>

        {/* Zone */}
        <div>
          <label className="block text-sm font-semibold text-ink mb-2">Zone</label>
          <select
            value={zone}
            onChange={(e) => setZone(e.target.value)}
            className="w-full border border-line rounded px-3 py-2 text-sm bg-canvas"
          >
            {Object.entries(ZONES).map(([name, rates]) => (
              <option key={name} value={name}>
                {name} (${rates.min}–${rates.max})
              </option>
            ))}
          </select>
        </div>

        {/* Military Checkbox (for Escort) */}
        {serviceType === 'twic_escort' && (
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isMilitary}
              onChange={(e) => setIsMilitary(e.target.checked)}
              className="rounded"
            />
            <span className="text-sm text-ink">Military/PCS ($80/vehicle)</span>
          </label>
        )}

        {/* Surcharges */}
        <div>
          <label className="block text-sm font-semibold text-ink mb-2">Surcharges</label>
          <div className="space-y-2">
            {Object.entries(SURCHARGES).map(([name, cost]) => (
              <label key={name} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedSurcharges.includes(name)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedSurcharges([...selectedSurcharges, name])
                    } else {
                      setSelectedSurcharges(selectedSurcharges.filter(s => s !== name))
                    }
                  }}
                  className="rounded"
                />
                <span className="text-sm text-ink">
                  {name} <span className="text-muted">(+${cost})</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Add Line Item Button */}
        <button
          onClick={addLineItem}
          className="w-full bg-accent hover:bg-accent-600 text-ink font-semibold py-2 px-3 rounded text-sm"
        >
          + Add Service to Quote
        </button>

        {/* Line Items Summary */}
        {lineItems.length > 0 && (
          <div className="border-t border-line pt-4">
            <h3 className="font-semibold text-ink mb-3">Services in Quote:</h3>
            <div className="space-y-2">
              {lineItems.map((item) => (
                <div key={item.id} className="bg-canvas border border-line rounded p-3 flex items-start justify-between">
                  <div className="text-sm">
                    <p className="font-medium text-ink">{item.serviceName}</p>
                    <p className="text-xs text-muted">
                      {item.quantity}x {item.zone}
                      {item.isMilitary && ' (Military)'}
                    </p>
                    {item.surcharges.length > 0 && (
                      <p className="text-xs text-muted">{item.surcharges.join(', ')}</p>
                    )}
                    <p className="font-semibold text-accent mt-1">${item.total}</p>
                  </div>
                  <button
                    onClick={() => removeLineItem(item.id)}
                    className="text-muted hover:text-ink text-lg"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

            {/* Grand Total */}
            <div className="mt-4 pt-4 border-t border-line">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-ink">Total Value:</span>
                <span className="text-2xl font-bold text-accent">${getGrandTotal()}</span>
              </div>
            </div>

            {/* Create Booking Button */}
            <button
              onClick={handleCreateBooking}
              disabled={loading}
              className="w-full mt-4 bg-accent hover:bg-accent-600 disabled:opacity-50 text-ink font-bold py-3 px-4 rounded text-sm"
            >
              {loading ? 'Creating...' : '✓ Create Booking & Add to Pipeline'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
