import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, fetchServices, fetchContacts } from '../lib/supabase'

// Every business defines its own service catalog under Settings > Services —
// this sidebar has no built-in notion of what's being sold. Line items are
// just "N x <catalog service> @ $price", which works the same whether the
// catalog is TWIC escorts, portrait sessions, or listing photos.
export default function BookingSidebar({ open, onClose }) {
  const qc = useQueryClient()
  const [selectedContact, setSelectedContact] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [newContactName, setNewContactName] = useState('')
  const [newContactEmail, setNewContactEmail] = useState('')
  const [serviceCode, setServiceCode] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [unitPrice, setUnitPrice] = useState('')
  const [lineItems, setLineItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [messagesToSend, setMessagesToSend] = useState({
    deliveryOrder: true,
    paymentLink: false,
  })

  const { data: contacts = [] } = useQuery({
    queryKey: ['contacts'],
    queryFn: () => fetchContacts(),
    enabled: open,
  })

  const { data: services = [] } = useQuery({
    queryKey: ['services'],
    queryFn: fetchServices,
    enabled: open,
  })

  // Default to the org's first catalog service once it loads.
  useEffect(() => {
    if (open && services.length > 0 && !serviceCode) {
      setServiceCode(services[0].code)
      setUnitPrice(String(services[0].default_rate ?? 0))
    }
  }, [open, services, serviceCode])

  const filteredContacts = contacts.filter(c =>
    c.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.email?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const onServiceChange = (code) => {
    setServiceCode(code)
    const svc = services.find((s) => s.code === code)
    if (svc) setUnitPrice(String(svc.default_rate ?? 0))
  }

  const addLineItem = () => {
    const svc = services.find((s) => s.code === serviceCode)
    if (!svc) {
      setError('Please select a service')
      return
    }
    const price = Number(unitPrice) || 0
    const qty = Math.max(1, Number(quantity) || 1)

    setLineItems([...lineItems, {
      id: Date.now(),
      serviceCode,
      serviceName: svc.name,
      quantity: qty,
      unitPrice: price,
      total: price * qty,
    }])
    setQuantity(1)
    setError('')
  }

  const removeLineItem = (id) => setLineItems(lineItems.filter(item => item.id !== id))

  const getGrandTotal = () => lineItems.reduce((sum, item) => sum + item.total, 0)

  const handleCreateBooking = async () => {
    if (!selectedContact && !newContactName) {
      setError('Please select or create a customer')
      return
    }

    if (!selectedContact && !newContactEmail) {
      setError('Please provide an email for the new customer')
      return
    }

    if (lineItems.length === 0) {
      setError('Please add at least one service')
      return
    }

    setLoading(true)
    setError('')

    const customerName = selectedContact?.full_name || newContactName
    const totalValue = getGrandTotal()

    try {
      const lineItemsSummary = lineItems
        .map(item => `${item.quantity}x ${item.serviceName} @ $${item.unitPrice} = $${item.total}`)
        .join('; ')

      const { data: { session } } = await supabase.auth.getSession()

      const res = await fetch('/.netlify/functions/create-booking', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token || ''}`,
        },
        body: JSON.stringify({
          contactId: selectedContact?.id || null,
          newContact: selectedContact ? null : { full_name: newContactName, email: newContactEmail },
          lineItemsSummary,
          totalValue,
          sendDeliveryOrder: messagesToSend.deliveryOrder,
          sendPaymentLink: messagesToSend.paymentLink,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(`Failed to create booking: ${data.error}`)
        setLoading(false)
        return
      }

      // Refresh relevant queries
      await qc.invalidateQueries({ queryKey: ['contacts'] })
      await qc.invalidateQueries({ queryKey: ['opportunities'] })
      await qc.invalidateQueries({ queryKey: ['pipeline'] })
      await qc.invalidateQueries({ queryKey: ['dashboard'] })

      // Reset form
      setSelectedContact(null)
      setSearchQuery('')
      setQuantity(1)
      setLineItems([])
      setNewContactName('')
      setNewContactEmail('')
      setMessagesToSend({ deliveryOrder: true, paymentLink: false })
      setError('')

      const emailNote = data.emailErrors?.length
        ? `\n\n⚠ ${data.emailErrors.join(' ')}`
        : data.emailsSent?.length
          ? `\n\n✓ Email sent to customer.`
          : ''
      alert(`✓ ${customerName} - $${totalValue} added to pipeline!${emailNote}`)
      onClose()
    } catch (err) {
      console.error('❌ Booking creation error:', err)
      setError(`Error creating booking: ${err.message}`)
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
                onClick={() => {
                  setSelectedContact(null)
                  setSearchQuery('')
                  setNewContactName('')
                  setNewContactEmail('')
                }}
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
                        setNewContactName('')
                        setNewContactEmail('')
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
          <label className="block text-sm font-semibold text-ink mb-2">Service</label>
          {services.length === 0 ? (
            <p className="text-xs text-muted">
              No services set up yet. Add your service catalog under{' '}
              <span className="font-medium text-ink">Settings → Services</span> first.
            </p>
          ) : (
            <select
              value={serviceCode}
              onChange={(e) => onServiceChange(e.target.value)}
              className="w-full border border-line rounded px-3 py-2 text-sm bg-canvas"
            >
              {services.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name} — ${Number(s.default_rate || 0).toFixed(0)}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Quantity + Price */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-semibold text-ink mb-2">Quantity</label>
            <input
              type="number"
              min="1"
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-full border border-line rounded px-3 py-2 text-sm bg-canvas"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-ink mb-2">Price (each)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
              className="w-full border border-line rounded px-3 py-2 text-sm bg-canvas"
            />
          </div>
        </div>

        {/* Add Line Item Button */}
        <button
          onClick={addLineItem}
          disabled={services.length === 0}
          className="w-full bg-accent hover:bg-accent-600 disabled:opacity-50 text-ink font-semibold py-2 px-3 rounded text-sm"
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
                    <p className="text-xs text-muted">{item.quantity}x @ ${item.unitPrice}</p>
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

            {/* Messages to Send */}
            <div className="mt-4 pt-4 border-t border-line">
              <label className="block text-sm font-semibold text-ink mb-3">Send to Customer:</label>
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={messagesToSend.deliveryOrder}
                    onChange={(e) => setMessagesToSend({ ...messagesToSend, deliveryOrder: e.target.checked })}
                    className="rounded"
                  />
                  <span className="text-sm text-ink">📋 Delivery Order Request</span>
                  <span className="text-xs text-muted">(asks for POA)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={messagesToSend.paymentLink}
                    onChange={(e) => setMessagesToSend({ ...messagesToSend, paymentLink: e.target.checked })}
                    className="rounded"
                  />
                  <span className="text-sm text-ink">💳 Payment Link Request</span>
                  <span className="text-xs text-muted">(after cleared)</span>
                </label>
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
