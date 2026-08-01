import { useCallback, useEffect, useRef, useState } from 'react'

/* Manual delivery-order corrector: erase anything wrong on a DO and type the
   correction in its place. Deliberately manual -- no OCR, no broker
   detection, nothing guessed on the dispatcher's behalf.

   Everything runs in this browser. A customer's delivery order is never
   uploaded anywhere, and pdf.js/jsPDF are served from /vendor rather than a
   CDN so the tool still works on the dead signal around a port gate. */

const RENDER_SCALE = 300 / 72       // 300 DPI -- what the port expects
const TEXT_FILL = 'rgb(28,28,28)'   // typical DO body ink
const DARK = 120                    // luminance below this counts as ink
const LIGHT = 150                   // above this counts as background

// pdf.js and jsPDF are UMD globals; load them once, on demand.
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve()
    const s = document.createElement('script')
    s.src = src
    s.onload = () => resolve()
    s.onerror = () => reject(new Error(`Could not load ${src}`))
    document.head.appendChild(s)
  })
}

const lum = (d, i) => d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114

export default function DeliveryOrderFix() {
  const canvasRef = useRef(null)
  const wrapRef = useRef(null)
  const overlayRef = useRef(null)
  const pagesRef = useRef([])         // one offscreen canvas per page
  const undoRef = useRef([])
  const dragRef = useRef(null)

  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [pageIndex, setPageIndex] = useState(0)
  const [pageCount, setPageCount] = useState(0)
  const [tool, setTool] = useState('erase')
  const [pending, setPending] = useState(null)   // click point for text
  const [text, setText] = useState('')
  const [size, setSize] = useState(22)
  const [toast, setToast] = useState('')
  const [queuedName, setQueuedName] = useState('')
  const [zoom, setZoom] = useState(1)          // 1 = fit page width
  const queuedRef = useRef(null)

  useEffect(() => {
    Promise.all([loadScript('/vendor/pdf.min.js'), loadScript('/vendor/jspdf.umd.min.js')])
      .then(() => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.js'
        setReady(true)
        if (queuedRef.current) {
          const f = queuedRef.current
          queuedRef.current = null
          setQueuedName('')
          openFile(f)
        }
      })
      .catch((e) => setError(e.message))
  }, [])

  const flash = useCallback((m) => {
    setToast(m)
    setTimeout(() => setToast(''), 2200)
  }, [])

  const ctx = () => canvasRef.current?.getContext('2d', { willReadFrequently: true })

  /* Paint a stored page onto the visible canvas. Kept free of state updates
     and driven by an effect below: the <canvas> only mounts once `loaded` is
     true, so painting inline right after setLoaded() would run while the ref
     was still null and silently leave a blank 300x150 default canvas. */
  const paint = useCallback((i) => {
    const src = pagesRef.current[i]
    const c = canvasRef.current
    if (!src || !c) return
    c.width = src.width
    c.height = src.height
    c.getContext('2d').drawImage(src, 0, 0)
  }, [])

  useEffect(() => {
    if (loaded) paint(pageIndex)
  }, [loaded, pageIndex, paint])

  // Edits are made on the visible canvas, then flushed back to the page store.
  const commit = useCallback(() => {
    const src = pagesRef.current[pageIndex]
    if (src && canvasRef.current) src.getContext('2d').drawImage(canvasRef.current, 0, 0)
  }, [pageIndex])

  async function openFile(file) {
    if (!file) return
    setError('')
    // Picked before pdf.js finished downloading -- hold it rather than
    // silently doing nothing.
    if (!window.pdfjsLib || !window.jspdf) {
      queuedRef.current = file
      setQueuedName(file.name || 'file')
      return
    }
    setBusy('Opening document…')
    pagesRef.current = []
    undoRef.current = []
    try {
      if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
        const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise
        for (let n = 1; n <= pdf.numPages; n++) {
          const page = await pdf.getPage(n)
          const vp = page.getViewport({ scale: RENDER_SCALE })
          const c = document.createElement('canvas')
          c.width = Math.round(vp.width)
          c.height = Math.round(vp.height)
          await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise
          pagesRef.current.push(c)
        }
      } else {
        await new Promise((resolve, reject) => {
          const img = new Image()
          img.onload = () => {
            // iOS Safari refuses canvases much beyond ~16M pixels, and a
            // modern phone camera clears that easily. Scale down to fit
            // rather than handing back a blank canvas.
            const MAX_PX = 16000000
            let w = img.naturalWidth
            let h = img.naturalHeight
            const px = w * h
            if (px > MAX_PX) {
              const k = Math.sqrt(MAX_PX / px)
              w = Math.floor(w * k)
              h = Math.floor(h * k)
            }
            const c = document.createElement('canvas')
            c.width = w
            c.height = h
            c.getContext('2d').drawImage(img, 0, 0, w, h)
            pagesRef.current.push(c)
            URL.revokeObjectURL(img.src)
            resolve()
          }
          img.onerror = () => reject(new Error(
            /\.hei[cf]$/i.test(file.name || '')
              ? 'This browser cannot open HEIC photos. On iPhone: Settings > Camera > Formats > Most Compatible, or share the photo as JPEG.'
              : 'That image could not be read.'
          ))
          img.src = URL.createObjectURL(file)
        })
      }
      setPageCount(pagesRef.current.length)
      setPageIndex(0)
      setLoaded(true)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setBusy('')
    }
  }

  function pushUndo() {
    const c = canvasRef.current
    undoRef.current.push({ page: pageIndex, data: ctx().getImageData(0, 0, c.width, c.height) })
    if (undoRef.current.length > 20) undoRef.current.shift()
  }

  function undo() {
    const last = undoRef.current.pop()
    if (!last) return flash('Nothing to undo')
    const src = pagesRef.current[last.page]
    if (!src) return
    if (last.page === pageIndex) commit()
    src.getContext('2d').putImageData(last.data, 0, 0)
    if (last.page !== pageIndex) setPageIndex(last.page)
    else paint(last.page)
    flash('Undone')
  }

  // Canvas coords from a pointer event -- the bitmap is 300 DPI but displayed
  // scaled down, so raw client coords would be wrong.
  function point(e) {
    const c = canvasRef.current
    const r = c.getBoundingClientRect()
    const s = e.touches?.[0] || e.changedTouches?.[0] || e
    return {
      x: Math.round((s.clientX - r.left) * (c.width / r.width)),
      y: Math.round((s.clientY - r.top) * (c.height / r.height)),
    }
  }

  /* Sample the page background from a ring just outside the selection, taking
     the most common light pixel rather than an average -- averaging drags in
     the very ink being removed and leaves a grey smear. */
  function sampleBackground(box) {
    const c = canvasRef.current
    const pad = 6
    const x0 = Math.max(0, box.x - pad)
    const y0 = Math.max(0, box.y - pad)
    const x1 = Math.min(c.width, box.x + box.w + pad)
    const y1 = Math.min(c.height, box.y + box.h + pad)
    const d = ctx().getImageData(x0, y0, x1 - x0, y1 - y0).data
    const counts = new Map()
    for (let i = 0; i < d.length; i += 4) {
      if (lum(d, i) < LIGHT) continue
      const key = `${d[i] >> 3},${d[i + 1] >> 3},${d[i + 2] >> 3}`
      const e = counts.get(key)
      if (e) e.n++
      else counts.set(key, { n: 1, r: d[i], g: d[i + 1], b: d[i + 2] })
    }
    let best = null
    for (const v of counts.values()) if (!best || v.n > best.n) best = v
    return best ? `rgb(${best.r},${best.g},${best.b})` : '#ffffff'
  }

  /* Table rules crossing the selection would be left broken by a plain wipe --
     on a document the port inspects that's an obvious tell. Detect them first
     so they can be redrawn afterwards. Strips are read in one call each; a
     per-pixel loop would be thousands of calls on a 300 DPI page. */
  function findRules(box) {
    const c = canvasRef.current
    const g = ctx()
    const probe = 3
    const rows = []
    const cols = []

    const lx = Math.max(0, box.x - probe)
    const rx = Math.min(c.width - 1, box.x + box.w + probe)
    const colL = g.getImageData(lx, box.y, 1, box.h).data
    const colR = g.getImageData(rx, box.y, 1, box.h).data
    for (let i = 0; i < box.h; i++) {
      const o = i * 4
      if (lum(colL, o) < LIGHT && lum(colR, o) < LIGHT) {
        rows.push({ y: box.y + i, color: `rgb(${colL[o]},${colL[o + 1]},${colL[o + 2]})` })
      }
    }

    const ty = Math.max(0, box.y - probe)
    const by = Math.min(c.height - 1, box.y + box.h + probe)
    const rowT = g.getImageData(box.x, ty, box.w, 1).data
    const rowB = g.getImageData(box.x, by, box.w, 1).data
    for (let i = 0; i < box.w; i++) {
      const o = i * 4
      if (lum(rowT, o) < LIGHT && lum(rowB, o) < LIGHT) {
        cols.push({ x: box.x + i, color: `rgb(${rowT[o]},${rowT[o + 1]},${rowT[o + 2]})` })
      }
    }
    return { rows, cols }
  }

  function eraseBox(box) {
    pushUndo()
    const g = ctx()
    const bg = sampleBackground(box)
    const { rows, cols } = findRules(box)
    g.fillStyle = bg
    g.fillRect(box.x, box.y, box.w, box.h)
    for (const r of rows) { g.fillStyle = r.color; g.fillRect(box.x, r.y, box.w, 1) }
    for (const r of cols) { g.fillStyle = r.color; g.fillRect(r.x, box.y, 1, box.h) }
    commit()
    flash('Erased')
  }

  function onDown(e) {
    if (tool !== 'erase' || !loaded) return
    e.preventDefault()
    dragRef.current = point(e)
  }

  function onMove(e) {
    if (!dragRef.current) return
    e.preventDefault()
    const p = point(e)
    const c = canvasRef.current
    const r = c.getBoundingClientRect()
    const wr = wrapRef.current.getBoundingClientRect()
    const sx = r.width / c.width
    const sy = r.height / c.height
    const o = overlayRef.current
    o.style.display = 'block'
    o.style.left = `${Math.min(dragRef.current.x, p.x) * sx + (r.left - wr.left)}px`
    o.style.top = `${Math.min(dragRef.current.y, p.y) * sy + (r.top - wr.top)}px`
    o.style.width = `${Math.abs(p.x - dragRef.current.x) * sx}px`
    o.style.height = `${Math.abs(p.y - dragRef.current.y) * sy}px`
  }

  function onUp(e) {
    if (!dragRef.current) return
    e.preventDefault()
    const p = point(e)
    const start = dragRef.current
    dragRef.current = null
    overlayRef.current.style.display = 'none'
    const box = {
      x: Math.min(start.x, p.x), y: Math.min(start.y, p.y),
      w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y),
    }
    if (box.w < 4 || box.h < 4) return
    eraseBox(box)
  }

  useEffect(() => {
    const move = (e) => onMove(e)
    const up = (e) => onUp(e)
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  })

  function onCanvasClick(e) {
    if (tool !== 'text' || !loaded) return
    setPending(point(e))
  }

  function placeText() {
    if (!text.trim()) return flash('Type the replacement text first')
    if (!pending) return flash('Tap the page where the text should go')
    pushUndo()
    const g = ctx()
    g.fillStyle = TEXT_FILL
    g.textBaseline = 'alphabetic'
    g.font = `bold ${Number(size || 22) * RENDER_SCALE}px "DejaVu Sans Condensed","Arial Narrow",Arial,sans-serif`
    g.fillText(text, pending.x, pending.y)
    commit()
    setPending(null)
    setText('')
    flash('Text placed')
  }

  const stamp = () => new Date().toISOString().slice(0, 10).replace(/-/g, '')

  /* iOS ignores the <a download> attribute outright -- on iPhone the file
     either opens in a viewer or nothing happens at all, so the corrected
     document would never actually be saved. Hand it to the system share
     sheet where that exists (Save to Files, Mail, AirDrop), and fall back to
     the anchor on desktop. */
  async function deliver(blob, filename) {
    const file = new File([blob], filename, { type: blob.type })
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename })
        flash('Shared — choose “Save to Files” to keep it')
        return
      } catch (err) {
        if (err?.name === 'AbortError') return   // user dismissed the sheet
        // anything else: fall through to the anchor
      }
    }
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10000)
    flash('Downloaded')
  }

  function downloadPng() {
    commit()
    pagesRef.current[pageIndex].toBlob(
      (b) => deliver(b, `Delivery_Order_Corrected_${stamp()}_p${pageIndex + 1}.png`),
      'image/png',
    )
  }

  function downloadPdf() {
    commit()
    const { jsPDF } = window.jspdf
    let pdf = null
    pagesRef.current.forEach((c, i) => {
      const w = c.width * 0.24
      const h = c.height * 0.24
      const orient = c.width > c.height ? 'l' : 'p'
      if (i === 0) pdf = new jsPDF({ orientation: orient, unit: 'pt', format: [w, h] })
      else pdf.addPage([w, h], orient)
      pdf.addImage(c.toDataURL('image/jpeg', 0.94), 'JPEG', 0, 0, w, h)
    })
    deliver(pdf.output('blob'), `Delivery_Order_Corrected_${stamp()}.pdf`)
  }

  function reset() {
    pagesRef.current = []
    undoRef.current = []
    setLoaded(false)
    setPageCount(0)
    setPageIndex(0)
    setPending(null)
    setText('')
    setTool('erase')
    setZoom(1)
    setQueuedName('')
    queuedRef.current = null
  }

  const toolBtn = (id, label) =>
    `flex-1 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
      tool === id
        ? 'border-accent bg-accent/10 text-ink'
        : 'border-line bg-surface text-muted hover:border-accent hover:text-ink'
    }`

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-ink">
          Delivery Order Fix
        </h1>
        <p className="max-w-2xl text-sm text-muted">
          Erase whatever's wrong on a delivery order and type the correction in its place.
          Everything happens on this device — the document is never uploaded anywhere.
        </p>
      </header>

      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-port">⚠️ {error}</p>}

      <div className="rounded-xl border border-line bg-surface p-5">
        <label
          className="relative mb-4 block cursor-pointer rounded-xl border-2 border-dashed border-line bg-canvas px-4 py-8 text-center transition-colors hover:border-accent"
          onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('border-accent') }}
          onDragLeave={(e) => e.currentTarget.classList.remove('border-accent')}
          onDrop={(e) => {
            e.preventDefault()
            e.currentTarget.classList.remove('border-accent')
            openFile(e.dataTransfer.files[0])
          }}
        >
          <span className="mb-2 block text-3xl">📄</span>
          <p className="text-sm text-muted">
            <span className="font-semibold text-accent">Tap to upload</span>
            <span className="hidden sm:inline"> or drag a PDF/image here</span>
          </p>
          <p className="mt-1 text-xs text-muted">PDF, photo, or scan — including a picture taken right now</p>
          {/* accept is MIME-based, not extensions: iOS matches on MIME and an
              extension list greys out Photos/Camera and excludes iPhone HEIC
              shots entirely. Never disabled -- a file picked before the PDF
              engine finishes downloading is queued instead, since on cellular
              that download takes seconds and a dead-looking box reads as
              broken. Positioned rather than display:none, which iOS Safari
              has known failures triggering through a wrapping label. */}
          <input
            type="file"
            accept="application/pdf,image/*"
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            onChange={(e) => { openFile(e.target.files[0]); e.target.value = '' }}
          />
        </label>

        {!ready && !error && (
          <p className="mb-2 text-sm text-muted">
            ⏳ Loading PDF engine… {queuedName ? `“${queuedName}” will open as soon as it's ready.` : 'You can pick a file now.'}
          </p>
        )}
        {busy && <p className="mb-2 text-sm text-accent">🔄 {busy}</p>}

        {loaded && (
          <>
            {pageCount > 1 && (
              <div className="mb-3 flex items-center justify-between gap-2">
                <button
                  className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink disabled:opacity-40"
                  disabled={pageIndex === 0}
                  onClick={() => { commit(); setPageIndex(pageIndex - 1) }}
                >‹ Prev</button>
                <span className="text-xs font-medium text-muted">Page {pageIndex + 1} of {pageCount}</span>
                <button
                  className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink disabled:opacity-40"
                  disabled={pageIndex === pageCount - 1}
                  onClick={() => { commit(); setPageIndex(pageIndex + 1) }}
                >Next ›</button>
              </div>
            )}

            <div className="mb-3 flex gap-2">
              <button className={toolBtn('erase')} onClick={() => { setTool('erase'); setPending(null) }}>🧽 Erase</button>
              <button className={toolBtn('text')} onClick={() => setTool('text')}>🔤 Text</button>
              <button
                className="flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-xs font-semibold text-muted hover:border-accent hover:text-ink"
                onClick={undo}
              >↶ Undo</button>
            </div>

            <p className="mb-3 rounded-lg border border-line bg-canvas px-3 py-2 text-xs text-muted">
              {tool === 'erase'
                ? <><span className="font-semibold text-ink">Erase:</span> drag a box over the text you want gone. The background is sampled from just outside your box, and any table borders you cross are redrawn.</>
                : <><span className="font-semibold text-ink">Text:</span> tap where the text should start — that point is the left edge of the baseline — then type it below and press Place.</>}
            </p>

            {pending && (
              <div className="mb-3 rounded-lg border border-accent bg-canvas p-3">
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">Replacement text</label>
                    <input
                      autoFocus
                      className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') placeText() }}
                      placeholder="Ship2Shore Booking"
                    />
                  </div>
                  <div className="w-20">
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">Size</label>
                    <input
                      type="number" min="8" max="72"
                      className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
                      value={size}
                      onChange={(e) => setSize(e.target.value)}
                    />
                  </div>
                </div>
                <div className="mt-3 flex justify-end gap-2">
                  <button className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted hover:text-ink" onClick={() => setPending(null)}>Cancel</button>
                  <button className="rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-ink hover:bg-accent-600" onClick={placeText}>Place text</button>
                </div>
              </div>
            )}

            {/* At fit-width a Letter page on a phone renders body text about
                three pixels tall, which is impossible to erase accurately.
                Zoom scrolls the wrapper instead of scaling the bitmap, so the
                exported 300 DPI output is unaffected. */}
            <div className="mb-2 flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Zoom</span>
              {[1, 2, 3, 4].map((z) => (
                <button
                  key={z}
                  onClick={() => setZoom(z)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                    zoom === z ? 'border-accent bg-accent/10 text-ink' : 'border-line text-muted hover:border-accent'
                  }`}
                >{z === 1 ? 'Fit' : `${z}x`}</button>
              ))}
            </div>

            <div ref={wrapRef} className="relative mb-4 overflow-auto rounded-xl border border-line bg-canvas p-2" style={{ maxHeight: '70vh' }}>
              <canvas
                ref={canvasRef}
                onMouseDown={onDown}
                onTouchStart={onDown}
                onTouchMove={onMove}
                onTouchEnd={onUp}
                onClick={onCanvasClick}
                className="block h-auto max-w-none rounded"
                style={{
                  width: `${zoom * 100}%`,
                  cursor: 'crosshair',
                  // Only swallow native gestures while erasing; in Text mode the
                  // page must still scroll and pinch-zoom normally on a phone.
                  touchAction: tool === 'erase' ? 'none' : 'auto',
                }}
              />
              <div ref={overlayRef} className="pointer-events-none absolute hidden border-2 border-accent bg-accent/20" />
            </div>

            <div className="flex flex-wrap gap-2">
              <button className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-ink hover:bg-accent-600" onClick={downloadPdf}>
                ✅ Download corrected PDF
              </button>
              <button className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink hover:border-accent" onClick={downloadPng}>
                🖼️ Download PNG (this page)
              </button>
              <button className="rounded-lg px-4 py-2 text-sm font-medium text-muted hover:text-ink" onClick={reset}>
                Start over
              </button>
            </div>
          </>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-lg border border-starboard bg-surface px-4 py-2 text-sm font-semibold text-starboard shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}
