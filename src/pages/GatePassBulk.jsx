import { useState } from 'react'
import { scanGatePassDocument, sendBulkGatePassRequest } from '../lib/supabase'

/* Scan-first bulk Gate Pass Request: dispatcher drops in every delivery
   order for one pickup trip (one BL# can cover several vehicles, and a
   trip can cover several BL#s), the AI reads vessel/voyage/BL#/vehicles off
   each document, the dispatcher reviews and corrects the results, and one
   combined email goes to NATSS/Ports America listing every BL# group with
   its vehicles line-by-line -- the format the port expects. Nothing is
   sent until the dispatcher presses Send; scanning itself only reads a
   document, it never saves or emails anything on its own. */

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
    reader.onerror = () => reject(new Error('Could not read that file'))
    reader.readAsDataURL(file)
  })
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

let nextId = 1
const newGroup = (overrides = {}) => ({
  id: nextId++,
  blNumber: '',
  vehicles: [{ description: '', vin: '' }],
  fileBase64: null,
  fileName: '',
  mimeType: '',
  scanning: false,
  scanError: '',
  ...overrides,
})

export default function GatePassBulk() {
  const [vessel, setVessel] = useState('')
  const [voyage, setVoyage] = useState('')
  const [driverName, setDriverName] = useState('')
  const [pickupDate, setPickupDate] = useState(todayISO())
  const [groups, setGroups] = useState([])
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [sent, setSent] = useState(null)

  async function addFiles(fileList) {
    const files = Array.from(fileList || [])
    if (!files.length) return

    for (const file of files) {
      const mimeType = file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : '')
      const id = nextId++
      const group = {
        id, blNumber: '', vehicles: [{ description: '', vin: '' }],
        fileBase64: null, fileName: file.name, mimeType, scanning: true, scanError: '',
      }
      setGroups((gs) => [...gs, group])

      try {
        const base64 = await fileToBase64(file)
        const result = await scanGatePassDocument(base64, mimeType)
        setGroups((gs) => gs.map((g) => (g.id !== id ? g : {
          ...g,
          fileBase64: base64,
          scanning: false,
          blNumber: result.blNumber || '',
          vehicles: result.vehicles?.length ? result.vehicles : [{ description: '', vin: '' }],
        })))
        setVessel((v) => v || result.vessel || '')
        setVoyage((v) => v || result.voyage || '')
      } catch (e) {
        setGroups((gs) => gs.map((g) => (g.id !== id ? g : {
          ...g, scanning: false, scanError: e.message || 'Could not read that document',
        })))
      }
    }
  }

  function updateGroup(id, patch) {
    setGroups((gs) => gs.map((g) => (g.id === id ? { ...g, ...patch } : g)))
  }

  function removeGroup(id) {
    setGroups((gs) => gs.filter((g) => g.id !== id))
  }

  function updateVehicle(groupId, idx, patch) {
    setGroups((gs) => gs.map((g) => (g.id !== groupId ? g : {
      ...g, vehicles: g.vehicles.map((v, i) => (i === idx ? { ...v, ...patch } : v)),
    })))
  }

  function addVehicle(groupId) {
    setGroups((gs) => gs.map((g) => (g.id !== groupId ? g : {
      ...g, vehicles: [...g.vehicles, { description: '', vin: '' }],
    })))
  }

  function removeVehicle(groupId, idx) {
    setGroups((gs) => gs.map((g) => (g.id !== groupId ? g : {
      ...g, vehicles: g.vehicles.length > 1 ? g.vehicles.filter((_, i) => i !== idx) : g.vehicles,
    })))
  }

  function addBlankGroup() {
    setGroups((gs) => [...gs, newGroup()])
  }

  const totalVehicles = groups.reduce((n, g) => n + g.vehicles.filter((v) => v.description.trim()).length, 0)
  const anyScanning = groups.some((g) => g.scanning)
  const missing = []
  if (!vessel.trim()) missing.push('Vessel')
  if (!driverName.trim()) missing.push('Driver name')
  if (!pickupDate.trim()) missing.push('Pickup date')
  if (!groups.length) missing.push('At least one document/BL#')
  groups.forEach((g, i) => {
    if (!g.blNumber.trim()) missing.push(`BL# for document ${i + 1}`)
    if (!g.vehicles.some((v) => v.description.trim())) missing.push(`At least one vehicle for BL# ${g.blNumber || `document ${i + 1}`}`)
  })
  const canSend = missing.length === 0 && !anyScanning && !sending

  async function handleSend() {
    setSendError('')
    setSending(true)
    try {
      const payload = {
        vessel: vessel.trim(),
        voyage: voyage.trim() || null,
        driverName: driverName.trim(),
        pickupDate,
        groups: groups.map((g) => ({
          blNumber: g.blNumber.trim(),
          vehicles: g.vehicles.filter((v) => v.description.trim()).map((v) => ({
            description: v.description.trim(),
            vin: v.vin.trim(),
          })),
          fileBase64: g.fileBase64,
          fileName: g.fileName,
          mimeType: g.mimeType,
        })),
      }
      const result = await sendBulkGatePassRequest(payload)
      setSent(result)
    } catch (e) {
      setSendError(e.message || 'Could not send the gate pass request')
    } finally {
      setSending(false)
    }
  }

  function startOver() {
    setVessel('')
    setVoyage('')
    setDriverName('')
    setPickupDate(todayISO())
    setGroups([])
    setSent(null)
    setSendError('')
  }

  if (sent) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-lg rounded-[var(--radius-card)] border border-line bg-surface p-6 text-center shadow-[var(--shadow-card)]">
          <span className="mb-2 block text-4xl">✅</span>
          <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-ink">Gate pass request sent</h1>
          <p className="mt-2 text-sm text-muted">
            Sent to NATSS.TricorSupport@portsamerica.com covering {sent.vehicleCount} vehicle{sent.vehicleCount === 1 ? '' : 's'}
            {groups.length > 1 ? ` across ${groups.length} BL#s` : ''}.
          </p>
          <button
            onClick={startOver}
            className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-ink hover:bg-accent-600"
          >
            Send another request
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-ink">Gate Pass Request</h1>
        <p className="max-w-2xl text-sm text-muted">
          Scan every delivery order for this pickup trip -- the AI reads the vessel, BL#, and every vehicle
          line item off each document. Review and fix anything below, then send one combined request to the
          port. Nothing is emailed until you press Send.
        </p>
      </header>

      {sendError && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-port">⚠️ {sendError}</p>}

      <div className="mb-6 rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
        <label
          className="relative mb-4 block cursor-pointer rounded-xl border-2 border-dashed border-line bg-canvas px-4 py-8 text-center transition-colors hover:border-accent"
          onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('border-accent') }}
          onDragLeave={(e) => e.currentTarget.classList.remove('border-accent')}
          onDrop={(e) => {
            e.preventDefault()
            e.currentTarget.classList.remove('border-accent')
            addFiles(e.dataTransfer.files)
          }}
        >
          <span className="mb-2 block text-3xl">📄</span>
          <p className="text-sm text-muted">
            <span className="font-semibold text-accent">Tap to add delivery orders</span>
            <span className="hidden sm:inline"> or drag them here</span>
          </p>
          <p className="mt-1 text-xs text-muted">One BL# per document -- add as many as this trip covers</p>
          <input
            type="file"
            accept="application/pdf,image/*"
            multiple
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            onChange={(e) => { addFiles(e.target.files); e.target.value = '' }}
          />
        </label>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">Vessel</label>
            <input
              value={vessel}
              onChange={(e) => setVessel(e.target.value)}
              placeholder="e.g. MOL ENDEAVOR"
              className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">Voyage (optional)</label>
            <input
              value={voyage}
              onChange={(e) => setVoyage(e.target.value)}
              className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">Driver name</label>
            <input
              value={driverName}
              onChange={(e) => setDriverName(e.target.value)}
              className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">Pickup date</label>
            <input
              type="date"
              value={pickupDate}
              onChange={(e) => setPickupDate(e.target.value)}
              className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>
        </div>
      </div>

      <div className="mb-6 space-y-4">
        {groups.map((g, gi) => (
          <div key={g.id} className="rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted">Document {gi + 1}</span>
                {g.fileName && <span className="truncate text-xs text-muted">📎 {g.fileName}</span>}
              </div>
              <button onClick={() => removeGroup(g.id)} className="text-xs font-medium text-muted hover:text-port">
                Remove
              </button>
            </div>

            {g.scanning && <p className="mb-3 text-sm text-accent">🔄 Reading document…</p>}
            {g.scanError && (
              <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-port">⚠️ {g.scanError} -- fill the fields in below by hand.</p>
            )}

            <div className="mb-3">
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">BL#</label>
              <input
                value={g.blNumber}
                onChange={(e) => updateGroup(g.id, { blNumber: e.target.value })}
                placeholder="e.g. 1800-9386800"
                className="w-full max-w-xs rounded-lg border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </div>

            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">Vehicles</label>
            <div className="space-y-2">
              {g.vehicles.map((v, vi) => (
                <div key={vi} className="flex items-center gap-2">
                  <span className="w-5 shrink-0 text-xs font-semibold text-muted">{vi + 1}.</span>
                  <input
                    value={v.description}
                    onChange={(e) => updateVehicle(g.id, vi, { description: e.target.value })}
                    placeholder="Year/make/model/color"
                    className="min-w-0 flex-1 rounded-lg border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-accent"
                  />
                  <input
                    value={v.vin}
                    onChange={(e) => updateVehicle(g.id, vi, { vin: e.target.value })}
                    placeholder="VIN#"
                    className="w-40 shrink-0 rounded-lg border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-accent"
                  />
                  <button
                    onClick={() => removeVehicle(g.id, vi)}
                    disabled={g.vehicles.length === 1}
                    className="shrink-0 rounded-lg px-2 py-2 text-xs font-medium text-muted hover:text-port disabled:opacity-30"
                    aria-label="Remove vehicle"
                  >✕</button>
                </div>
              ))}
            </div>
            <button
              onClick={() => addVehicle(g.id)}
              className="mt-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-muted hover:border-accent hover:text-ink"
            >
              + Add vehicle
            </button>
          </div>
        ))}

        {!groups.length && (
          <p className="rounded-[var(--radius-card)] border border-dashed border-line bg-canvas p-6 text-center text-sm text-muted">
            Add a delivery order above to get started.
          </p>
        )}

        <button
          onClick={addBlankGroup}
          className="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-ink hover:border-accent"
        >
          + Add a BL# manually
        </button>
      </div>

      <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm text-muted">
            Ready to send: <span className="font-semibold text-ink">{totalVehicles} vehicle{totalVehicles === 1 ? '' : 's'}</span> across{' '}
            <span className="font-semibold text-ink">{groups.length} BL#{groups.length === 1 ? '' : 's'}</span>
          </p>
        </div>
        {!canSend && missing.length > 0 && (
          <p className="mb-3 text-xs text-muted">Still needed: {missing.join(', ')}</p>
        )}
        <button
          onClick={handleSend}
          disabled={!canSend}
          className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-ink hover:bg-accent-600 disabled:opacity-40"
        >
          {sending ? 'Sending…' : '✉️ Send gate pass request to the port'}
        </button>
      </div>
    </div>
  )
}
