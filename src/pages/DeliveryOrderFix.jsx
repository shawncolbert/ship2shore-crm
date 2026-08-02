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
  const redoRef = useRef([])
  const dragRef = useRef(null)
  const strokingRef = useRef(null)   // active freehand stroke

  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [pageIndex, setPageIndex] = useState(0)
  const [pageCount, setPageCount] = useState(0)
  const [tool, setTool] = useState('erase')
  // The text stays a live, movable object until Place is pressed, so it can be
  // nudged into alignment first. Burning it in on the first tap meant a
  // millimetre out was undo-and-retype.
  const [draft, setDraft] = useState(null)      // { x, y } baseline-left, canvas px
  const [text, setText] = useState('')
  const [size, setSize] = useState(22)
  const [toast, setToast] = useState('')
  const [queuedName, setQueuedName] = useState('')
  const [fileInfo, setFileInfo] = useState('')
  // Bumped on every successful load. Without it, opening a second document
  // leaves `loaded` true and `pageIndex` 0, React bails on the identical
  // state, the repaint effect never re-runs and the canvas keeps the previous
  // bitmap -- which reads as "I picked a file and nothing appeared".
  const [docId, setDocId] = useState(0)
  const [bigStep, setBigStep] = useState(false)
  const [signOpen, setSignOpen] = useState(false)
  // Saved signature persists between documents -- it is drawn once and reused,
  // and never leaves this device.
  const [signature, setSignature] = useState(() => {
    try { return localStorage.getItem('s2s_do_signature') || '' } catch { return '' }
  })
  const [stamp2, setStamp2] = useState(null)   // { img, x, y, w, h } placed signature
  const stampImgRef = useRef(null)
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

  /* Draw the clean page, then the uncommitted draft on top. Using the same
     fillText call the final bake uses means the preview is not an
     approximation -- it is the result. */
  const renderView = useCallback(() => {
    paint(pageIndex)
    const g = canvasRef.current?.getContext('2d')
    if (!g || !draft || !text.trim()) return
    g.fillStyle = TEXT_FILL
    g.textBaseline = 'alphabetic'
    g.font = `bold ${Number(size || 22) * RENDER_SCALE}px "DejaVu Sans Condensed","Arial Narrow",Arial,sans-serif`
    g.fillText(text, draft.x, draft.y)
    // Faint guide so the text is findable at Fit zoom; never committed.
    const w = g.measureText(text).width
    const h = Number(size || 22) * RENDER_SCALE
    g.strokeStyle = 'rgba(232,163,23,0.9)'
    g.lineWidth = 3
    g.strokeRect(draft.x - 6, draft.y - h, w + 12, h + 12)
  }, [pageIndex, draft, text, size, paint])

  /* A placed signature is positioned the same way text is: live and movable
     until Place is pressed, with the outline stripped before committing. */
  const renderStamp = useCallback(() => {
    paint(pageIndex)
    const g = canvasRef.current?.getContext('2d')
    const img = stampImgRef.current
    if (!g || !stamp2 || !img) return
    g.drawImage(img, stamp2.x, stamp2.y, stamp2.w, stamp2.h)
    g.strokeStyle = 'rgba(232,163,23,0.9)'
    g.lineWidth = 3
    g.strokeRect(stamp2.x - 4, stamp2.y - 4, stamp2.w + 8, stamp2.h + 8)
  }, [pageIndex, stamp2, paint])

  useEffect(() => {
    if (!loaded) return
    if (stamp2) renderStamp()
    else renderView()
  }, [loaded, docId, renderView, renderStamp, stamp2])

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
    setFileInfo(`${file.name || 'file'} · ${file.type || 'unknown type'} · ${(file.size / 1048576).toFixed(1)} MB`)
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
        const store = (bmp, w, h) => {
          const MAX_PX = 16000000
          let dw = w
          let dh = h
          if (w * h > MAX_PX) {
            const k = Math.sqrt(MAX_PX / (w * h))
            dw = Math.floor(w * k)
            dh = Math.floor(h * k)
          }
          const c = document.createElement('canvas')
          c.width = dw
          c.height = dh
          c.getContext('2d').drawImage(bmp, 0, 0, dw, dh)
          pagesRef.current.push(c)
        }

        // createImageBitmap decodes formats <img> sometimes will not, and
        // applies the EXIF rotation iPhone photos carry.
        let decoded = false
        if (typeof createImageBitmap === 'function') {
          try {
            const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
            store(bmp, bmp.width, bmp.height)
            bmp.close?.()
            decoded = true
          } catch {
            decoded = false
          }
        }

        if (!decoded) await new Promise((resolve, reject) => {
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
      if (!pagesRef.current.length) throw new Error('That file produced no pages.')
      setPageCount(pagesRef.current.length)
      setPageIndex(0)
      setDocId((n) => n + 1)
      setLoaded(true)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setBusy('')
    }
  }

  /* Snapshot the committed page rather than the visible canvas: while a text
     draft is being positioned the canvas shows an uncommitted preview, and
     capturing that would bake the preview into the undo history. */
  function pushUndo() {
    const src = pagesRef.current[pageIndex]
    if (!src) return
    undoRef.current.push({
      page: pageIndex,
      data: src.getContext('2d').getImageData(0, 0, src.width, src.height),
    })
    if (undoRef.current.length > 20) undoRef.current.shift()
    redoRef.current = []          // a fresh edit invalidates the redo trail
  }

  function undo() {
    const last = undoRef.current.pop()
    if (!last) return flash('Nothing to undo')
    const src = pagesRef.current[last.page]
    if (!src) return
    redoRef.current.push({
      page: last.page,
      data: src.getContext('2d').getImageData(0, 0, src.width, src.height),
    })
    src.getContext('2d').putImageData(last.data, 0, 0)
    if (last.page !== pageIndex) setPageIndex(last.page)
    else paint(last.page)
    flash('Undone')
  }

  function redo() {
    const next = redoRef.current.pop()
    if (!next) return flash('Nothing to redo')
    const src = pagesRef.current[next.page]
    if (!src) return
    undoRef.current.push({
      page: next.page,
      data: src.getContext('2d').getImageData(0, 0, src.width, src.height),
    })
    src.getContext('2d').putImageData(next.data, 0, 0)
    if (next.page !== pageIndex) setPageIndex(next.page)
    else paint(next.page)
    flash('Redone')
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

  const DRAW_TOOLS = ['pen', 'highlight', 'rect']

  function strokeStyleFor(t) {
    // Highlighter is translucent and multiplies, so the form text stays legible
    // underneath instead of being painted over.
    if (t === 'highlight') return { color: 'rgba(255,214,0,0.38)', width: 46, composite: 'multiply' }
    if (t === 'rect') return { color: 'rgb(210,30,45)', width: 7, composite: 'source-over' }
    return { color: 'rgb(28,28,28)', width: 8, composite: 'source-over' }
  }

  function onDown(e) {
    if (!loaded) return
    if (tool !== 'erase' && !DRAW_TOOLS.includes(tool)) return
    e.preventDefault()
    const p = point(e)
    dragRef.current = p

    if (tool === 'pen' || tool === 'highlight') {
      pushUndo()
      strokingRef.current = { last: p, points: [p] }
    }
  }

  function onMove(e) {
    if (!dragRef.current) return
    e.preventDefault()
    const p = point(e)

    // Freehand: draw as the finger moves so the stroke appears live.
    if (strokingRef.current) {
      const st = strokeStyleFor(tool)
      strokingRef.current.points.push(p)

      if (tool === 'highlight') {
        /* Repaint the clean page and lay the whole stroke down as ONE path.
           Stroking segment-by-segment made each round cap multiply over the
           previous one, so the highlight came out as a string of darker beads
           instead of an even band. */
        paint(pageIndex)
        const g = ctx()
        const pts = strokingRef.current.points
        g.save()
        g.globalCompositeOperation = st.composite
        g.strokeStyle = st.color
        g.lineWidth = st.width
        g.lineCap = 'round'
        g.lineJoin = 'round'
        g.beginPath()
        g.moveTo(pts[0].x, pts[0].y)
        for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y)
        g.stroke()
        g.restore()
        strokingRef.current.last = p
        return
      }

      const g = ctx()
      g.save()
      g.globalCompositeOperation = st.composite
      g.strokeStyle = st.color
      g.lineWidth = st.width
      g.lineCap = 'round'
      g.lineJoin = 'round'
      g.beginPath()
      g.moveTo(strokingRef.current.last.x, strokingRef.current.last.y)
      g.lineTo(p.x, p.y)
      g.stroke()
      g.restore()
      strokingRef.current.last = p
      return
    }

    // Erase and rectangle both preview as a marquee before committing.
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

    if (strokingRef.current) {
      strokingRef.current = null
      dragRef.current = null
      commit()
      return
    }

    const p = point(e)
    const start = dragRef.current
    dragRef.current = null
    overlayRef.current.style.display = 'none'
    const box = {
      x: Math.min(start.x, p.x), y: Math.min(start.y, p.y),
      w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y),
    }
    if (box.w < 4 || box.h < 4) return

    if (tool === 'rect') {
      pushUndo()
      const g = ctx()
      const st = strokeStyleFor('rect')
      g.save()
      g.strokeStyle = st.color
      g.lineWidth = st.width
      g.strokeRect(box.x, box.y, box.w, box.h)
      g.restore()
      commit()
      flash('Box drawn')
      return
    }

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
    setDraft(point(e))
  }

  // Nudge in canvas pixels; at 300 DPI 10px is about a hundredth of an inch,
  // fine enough to line up with a printed row but visible on a phone.
  const nudge = (dx, dy) =>
    setDraft((d) => (d ? { x: d.x + dx, y: d.y + dy } : d))

  function placeText() {
    if (!text.trim()) return flash('Type the replacement text first')
    if (!draft) return flash('Tap the page where the text should go')
    pushUndo()
    // Redraw without the positioning outline, then commit that exact bitmap.
    paint(pageIndex)
    const g = ctx()
    g.fillStyle = TEXT_FILL
    g.textBaseline = 'alphabetic'
    g.font = `bold ${Number(size || 22) * RENDER_SCALE}px "DejaVu Sans Condensed","Arial Narrow",Arial,sans-serif`
    g.fillText(text, draft.x, draft.y)
    commit()
    setDraft(null)
    setText('')
    flash('Text placed')
  }

  function beginStamp(dataUrl) {
    const img = new Image()
    img.onload = () => {
      stampImgRef.current = img
      const c = canvasRef.current
      // Land it at a readable default width relative to the page, not the
      // signature pad's own pixel size.
      const w = Math.round((c?.width || 2550) * 0.28)
      const h = Math.round((w * img.height) / img.width)
      setStamp2({ x: Math.round((c?.width || 2550) * 0.12), y: Math.round((c?.height || 3300) * 0.6), w, h })
    }
    img.src = dataUrl
  }

  function placeStamp() {
    if (!stamp2 || !stampImgRef.current) return
    pushUndo()
    paint(pageIndex)                      // clean page, no positioning outline
    ctx().drawImage(stampImgRef.current, stamp2.x, stamp2.y, stamp2.w, stamp2.h)
    commit()
    setStamp2(null)
    flash('Signature placed')
  }

  const nudgeStamp = (dx, dy) =>
    setStamp2((v) => (v ? { ...v, x: v.x + dx, y: v.y + dy } : v))

  const resizeStamp = (factor) =>
    setStamp2((v) => (v ? { ...v, w: Math.round(v.w * factor), h: Math.round(v.h * factor) } : v))

  function quickInsert(kind) {
    if (!loaded) return flash('Open a document first')
    const c = canvasRef.current
    const value = kind === 'date'
      ? new Date().toLocaleDateString('en-US')
      : kind === 'check' ? '\u2713' : '\u2717'
    setTool('text')
    setText(value)
    setSize(kind === 'date' ? 22 : 30)
    setDraft({ x: Math.round(c.width * 0.2), y: Math.round(c.height * 0.5) })
    flash('Tap the page or nudge to position')
  }

  function cancelDraft() {
    setDraft(null)
    setText('')
    setStamp2(null)
  }

  const textFont = (pt) => `bold ${Number(pt || 22) * RENDER_SCALE}px "DejaVu Sans Condensed","Arial Narrow",Arial,sans-serif`

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
    setDraft(null)
    setText('')
    setTool('erase')
    setZoom(1)
    setFileInfo('')
    setQueuedName('')
    queuedRef.current = null
  }

  // 10 canvas px at 300 DPI is about a hundredth of an inch -- fine enough to
  // sit on a printed baseline; 40 for crossing a cell quickly.
  const step = bigStep ? 40 : 10
  const nudgeBtn = 'flex h-11 w-11 items-center justify-center rounded-lg border border-line bg-surface text-base font-bold text-ink active:bg-accent/20'
  const miniBtn = 'rounded-lg border border-line bg-surface px-3 py-2 text-xs font-semibold text-muted hover:border-accent hover:text-ink'

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
        {/* Echo the picked file back. A blank preview with no explanation is
            impossible to diagnose from the other end of a phone call. */}
        {fileInfo && !busy && (
          <p className="mb-2 truncate text-xs text-muted">📎 {fileInfo}</p>
        )}

        {loaded && (
          <>
            {pageCount > 1 && (
              <div className="mb-3 flex items-center justify-between gap-2">
                <button
                  className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink disabled:opacity-40"
                  disabled={pageIndex === 0}
                  onClick={() => { cancelDraft(); commit(); setPageIndex(pageIndex - 1) }}
                >‹ Prev</button>
                <span className="text-xs font-medium text-muted">Page {pageIndex + 1} of {pageCount}</span>
                <button
                  className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink disabled:opacity-40"
                  disabled={pageIndex === pageCount - 1}
                  onClick={() => { cancelDraft(); commit(); setPageIndex(pageIndex + 1) }}
                >Next ›</button>
              </div>
            )}

            <div className="mb-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
              <button className={toolBtn('erase')} onClick={() => { setTool('erase'); cancelDraft() }}>🧽 Erase</button>
              <button className={toolBtn('text')} onClick={() => { setTool('text'); setStamp2(null) }}>🔤 Text</button>
              <button className={toolBtn('pen')} onClick={() => { setTool('pen'); cancelDraft() }}>✏️ Draw</button>
              <button className={toolBtn('highlight')} onClick={() => { setTool('highlight'); cancelDraft() }}>🖍 Mark</button>
              <button className={toolBtn('rect')} onClick={() => { setTool('rect'); cancelDraft() }}>▭ Box</button>
              <button
                className={toolBtn('sign')}
                onClick={() => { cancelDraft(); signature ? beginStamp(signature) : setSignOpen(true) }}
              >✍️ Sign</button>
            </div>

            <div className="mb-3 flex flex-wrap gap-2">
              <button className={miniBtn} onClick={() => quickInsert('date')}>📅 Date</button>
              <button className={miniBtn} onClick={() => quickInsert('check')}>✓ Check</button>
              <button className={miniBtn} onClick={() => quickInsert('cross')}>✗ Cross</button>
              <button className={miniBtn} onClick={undo}>↶ Undo</button>
              <button className={miniBtn} onClick={redo}>↷ Redo</button>
              {signature && (
                <button className={miniBtn} onClick={() => setSignOpen(true)}>✍️ Redo signature</button>
              )}
            </div>

            <p className="mb-3 rounded-lg border border-line bg-canvas px-3 py-2 text-xs text-muted">
              {tool === 'erase' && <><span className="font-semibold text-ink">Erase:</span> drag a box over what you want gone. The background is sampled from just outside your box, and any table borders you cross are redrawn.</>}
              {tool === 'text' && <><span className="font-semibold text-ink">Text:</span> tap where it should go, type it, then nudge it into place with the arrows. Nothing is written onto the document until you press Place.</>}
              {tool === 'pen' && <><span className="font-semibold text-ink">Draw:</span> drag to draw freehand.</>}
              {tool === 'highlight' && <><span className="font-semibold text-ink">Mark:</span> drag to highlight. The text underneath stays readable.</>}
              {tool === 'rect' && <><span className="font-semibold text-ink">Box:</span> drag to outline an area in red.</>}
              {tool === 'sign' && <><span className="font-semibold text-ink">Sign:</span> position with the arrows, resize, then press Place.</>}
            </p>

            {draft && (
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

                {/* Fine positioning. Tapping the page moves it roughly; these
                    line it up with the printed row. Big hit areas because this
                    is used one-handed on a phone. */}
                <div className="mt-3">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Nudge into place</span>
                    <label className="flex items-center gap-1 text-[10px] font-medium text-muted">
                      <input type="checkbox" checked={bigStep} onChange={(e) => setBigStep(e.target.checked)} />
                      Bigger steps
                    </label>
                  </div>
                  <div className="flex items-center justify-center gap-2">
                    <button className={nudgeBtn} onClick={() => nudge(-step, 0)} aria-label="Move left">←</button>
                    <div className="flex flex-col gap-2">
                      <button className={nudgeBtn} onClick={() => nudge(0, -step)} aria-label="Move up">↑</button>
                      <button className={nudgeBtn} onClick={() => nudge(0, step)} aria-label="Move down">↓</button>
                    </div>
                    <button className={nudgeBtn} onClick={() => nudge(step, 0)} aria-label="Move right">→</button>
                  </div>
                  <p className="mt-2 text-center text-[11px] text-muted">…or tap the page again to move it there</p>
                </div>

                <div className="mt-3 flex justify-end gap-2">
                  <button className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted hover:text-ink" onClick={cancelDraft}>Cancel</button>
                  <button className="rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-ink hover:bg-accent-600" onClick={placeText}>Place text</button>
                </div>
              </div>
            )}

            {stamp2 && (
              <div className="mb-3 rounded-lg border border-accent bg-canvas p-3">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted">Position signature</div>
                <div className="flex items-center justify-center gap-2">
                  <button className={nudgeBtn} onClick={() => nudgeStamp(-step, 0)} aria-label="Sig left">←</button>
                  <div className="flex flex-col gap-2">
                    <button className={nudgeBtn} onClick={() => nudgeStamp(0, -step)} aria-label="Sig up">↑</button>
                    <button className={nudgeBtn} onClick={() => nudgeStamp(0, step)} aria-label="Sig down">↓</button>
                  </div>
                  <button className={nudgeBtn} onClick={() => nudgeStamp(step, 0)} aria-label="Sig right">→</button>
                  <span className="mx-1 h-8 w-px bg-line" />
                  <button className={nudgeBtn} onClick={() => resizeStamp(0.85)} aria-label="Smaller">−</button>
                  <button className={nudgeBtn} onClick={() => resizeStamp(1.18)} aria-label="Bigger">+</button>
                </div>
                <label className="mt-2 flex items-center justify-center gap-1 text-[10px] font-medium text-muted">
                  <input type="checkbox" checked={bigStep} onChange={(e) => setBigStep(e.target.checked)} />
                  Bigger steps
                </label>
                <div className="mt-3 flex justify-end gap-2">
                  <button className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted hover:text-ink" onClick={() => setStamp2(null)}>Cancel</button>
                  <button className="rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-ink hover:bg-accent-600" onClick={placeStamp}>Place signature</button>
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

      {signOpen && (
        <SignaturePad
          onCancel={() => setSignOpen(false)}
          onSave={(dataUrl) => {
            setSignature(dataUrl)
            try { localStorage.setItem('s2s_do_signature', dataUrl) } catch { /* private mode */ }
            setSignOpen(false)
            setTool('sign')
            beginStamp(dataUrl)
          }}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-lg border border-starboard bg-surface px-4 py-2 text-sm font-semibold text-starboard shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}

/* Draw-once signature pad. Kept on-device: the image is stored in
   localStorage and never uploaded, same as the documents themselves. */
function SignaturePad({ onSave, onCancel }) {
  const ref = useRef(null)
  const drawing = useRef(false)
  const dirty = useRef(false)

  const pos = (e) => {
    const c = ref.current
    const r = c.getBoundingClientRect()
    const s = e.touches?.[0] || e.changedTouches?.[0] || e
    return { x: (s.clientX - r.left) * (c.width / r.width), y: (s.clientY - r.top) * (c.height / r.height) }
  }

  const start = (e) => {
    e.preventDefault()
    drawing.current = true
    const g = ref.current.getContext('2d')
    const p = pos(e)
    g.strokeStyle = '#111'
    g.lineWidth = 5
    g.lineCap = 'round'
    g.lineJoin = 'round'
    g.beginPath()
    g.moveTo(p.x, p.y)
  }
  const move = (e) => {
    if (!drawing.current) return
    e.preventDefault()
    const g = ref.current.getContext('2d')
    const p = pos(e)
    g.lineTo(p.x, p.y)
    g.stroke()
    dirty.current = true
  }
  const end = (e) => { if (drawing.current) { e.preventDefault(); drawing.current = false } }

  const clear = () => {
    const c = ref.current
    c.getContext('2d').clearRect(0, 0, c.width, c.height)
    dirty.current = false
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <div className="relative w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-xl">
        <h2 className="font-[family-name:var(--font-display)] text-lg font-bold text-ink">Draw your signature</h2>
        <p className="mb-3 text-xs text-muted">Use your finger or mouse. It's saved on this device for next time.</p>
        <canvas
          ref={ref}
          width={640}
          height={240}
          onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
          onTouchStart={start} onTouchMove={move} onTouchEnd={end}
          className="w-full rounded-xl border-2 border-dashed border-line bg-canvas"
          style={{ touchAction: 'none' }}
        />
        <div className="mt-3 flex justify-between gap-2">
          <button className="rounded-lg px-3 py-2 text-xs font-medium text-muted hover:text-ink" onClick={clear}>Clear</button>
          <div className="flex gap-2">
            <button className="rounded-lg px-3 py-2 text-xs font-medium text-muted hover:text-ink" onClick={onCancel}>Cancel</button>
            <button
              className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-ink hover:bg-accent-600"
              onClick={() => {
                if (!dirty.current) return
                // Trim to the ink so the placed signature has no dead margin.
                const c = ref.current
                const d = c.getContext('2d').getImageData(0, 0, c.width, c.height)
                let minX = c.width, minY = c.height, maxX = -1, maxY = -1
                for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
                  if (d.data[(y * c.width + x) * 4 + 3] > 20) {
                    if (x < minX) minX = x
                    if (x > maxX) maxX = x
                    if (y < minY) minY = y
                    if (y > maxY) maxY = y
                  }
                }
                if (maxX < 0) return
                const pad = 8
                const out = document.createElement('canvas')
                out.width = maxX - minX + pad * 2
                out.height = maxY - minY + pad * 2
                out.getContext('2d').drawImage(c, minX - pad, minY - pad, out.width, out.height, 0, 0, out.width, out.height)
                onSave(out.toDataURL('image/png'))
              }}
            >Use signature</button>
          </div>
        </div>
      </div>
    </div>
  )
}
