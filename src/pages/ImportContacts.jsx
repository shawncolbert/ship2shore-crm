import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  parseCsvFile, parseVcfFile, guessFieldMapping, applyMapping, importContacts, downloadFailedRows,
  IMPORT_FIELDS,
} from '../lib/contactImport'

const card = 'rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)]'
const btn = 'inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-canvas'
const btnAccent = 'inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] bg-accent px-3 py-2 text-sm font-semibold text-ink hover:bg-accent-600 disabled:opacity-50'
const h2 = 'mb-3 text-xs font-semibold uppercase tracking-wide text-muted'
const input = 'w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-accent'

// Step machine: upload -> (mapping, CSV only) -> summary -> importing -> result
export default function ImportContacts() {
  const navigate = useNavigate()
  const [step, setStep] = useState('upload')
  const [format, setFormat] = useState(null) // 'csv' | 'vcf'
  const [err, setErr] = useState('')
  const [parsing, setParsing] = useState(false)

  // CSV-specific
  const [csvHeaders, setCsvHeaders] = useState([])
  const [csvRows, setCsvRows] = useState([])
  const [mapping, setMapping] = useState({})

  // Shared, post-mapping/parse
  const [mappedRows, setMappedRows] = useState([])

  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState(null)

  const reset = () => {
    setStep('upload'); setFormat(null); setErr(''); setCsvHeaders([]); setCsvRows([])
    setMapping({}); setMappedRows([]); setResult(null)
  }

  const onCsvSelected = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setErr(''); setParsing(true)
    try {
      const { fields, rows } = await parseCsvFile(file)
      if (!fields.length || !rows.length) throw new Error('That file has no rows we could read.')
      setCsvHeaders(fields)
      setCsvRows(rows)
      setMapping(guessFieldMapping(fields))
      setFormat('csv')
      setStep('mapping')
    } catch (e2) {
      setErr(e2.message || 'Could not read that CSV file.')
    } finally {
      setParsing(false)
    }
  }

  const onVcfSelected = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setErr(''); setParsing(true)
    try {
      const text = await file.text()
      const rows = parseVcfFile(text)
      if (!rows.length) throw new Error('No contacts found in that file.')
      setMappedRows(rows)
      setFormat('vcf')
      setStep('summary')
    } catch (e2) {
      setErr(e2.message || 'Could not read that vCard file.')
    } finally {
      setParsing(false)
    }
  }

  const confirmMapping = () => {
    const mapped = applyMapping(csvRows, mapping)
    const usable = mapped.filter((r) => r.full_name || r.phone || r.email)
    if (!usable.length) { setErr('None of the mapped rows have a name, phone, or email — check your column mapping.'); return }
    setErr('')
    setMappedRows(usable)
    setStep('summary')
  }

  const runImport = async () => {
    setImporting(true); setErr('')
    try {
      const r = await importContacts(mappedRows, { source: 'import' })
      setResult(r)
      setStep('result')
    } catch (e2) {
      setErr(e2.message || 'Import failed — nothing was saved.')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6 lg:p-8">
      <Link to="/contacts" className="text-sm text-muted hover:text-ink">‹ Contacts</Link>
      <header className="mt-3 mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-ink">Import Contacts</h1>
        <p className="text-sm text-muted">Bring in your existing contacts from a CSV export or a vCard (.vcf) file.</p>
      </header>

      {err && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-port">⚠️ {err}</p>}

      {step === 'upload' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <UploadCard
            title="CSV file"
            description="Exported from iPhone Contacts, Google Contacts, Outlook, or another CRM. You'll map the columns next."
            accept=".csv,text/csv"
            onSelect={onCsvSelected}
            busy={parsing}
          />
          <UploadCard
            title="vCard (.vcf)"
            description="A single contact, or one file with every contact (e.g. iPhone's 'export all contacts')."
            accept=".vcf,text/vcard"
            onSelect={onVcfSelected}
            busy={parsing}
          />
        </div>
      )}

      {step === 'mapping' && (
        <div className="space-y-5">
          <div className={card}>
            <h2 className={h2}>Preview (first 5 rows)</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-line text-left text-muted">
                    {csvHeaders.map((h) => <th key={h} className="py-1.5 pr-3 font-semibold">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {csvRows.slice(0, 5).map((row, i) => (
                    <tr key={i} className="border-b border-line/60">
                      {csvHeaders.map((h) => <td key={h} className="py-1.5 pr-3 text-ink">{row[h]}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted">{csvRows.length} rows found in the file.</p>
          </div>

          <div className={card}>
            <h2 className={h2}>Map columns to contact fields</h2>
            <div className="space-y-2">
              {csvHeaders.map((h) => (
                <div key={h} className="grid grid-cols-2 items-center gap-3">
                  <span className="truncate text-sm text-ink" title={h}>{h}</span>
                  <select
                    value={mapping[h] || ''}
                    onChange={(e) => setMapping((m) => ({ ...m, [h]: e.target.value }))}
                    className={input}
                  >
                    {IMPORT_FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button onClick={reset} className={btn}>Start over</button>
            <button onClick={confirmMapping} className={btnAccent}>Continue</button>
          </div>
        </div>
      )}

      {step === 'summary' && (
        <div className="space-y-5">
          <div className={card}>
            <h2 className={h2}>Ready to import</h2>
            <p className="text-sm text-ink"><strong>{mappedRows.length}</strong> contact{mappedRows.length === 1 ? '' : 's'} will be imported.</p>
            <p className="mt-1 text-xs text-muted">Contacts matching an existing phone or email for this organization will be skipped automatically.</p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-line text-left text-muted">
                    <th className="py-1.5 pr-3 font-semibold">Name</th>
                    <th className="py-1.5 pr-3 font-semibold">Phone</th>
                    <th className="py-1.5 pr-3 font-semibold">Email</th>
                    <th className="py-1.5 pr-3 font-semibold">Company</th>
                  </tr>
                </thead>
                <tbody>
                  {mappedRows.slice(0, 5).map((row, i) => (
                    <tr key={i} className="border-b border-line/60">
                      <td className="py-1.5 pr-3 text-ink">{row.full_name || '—'}</td>
                      <td className="py-1.5 pr-3 text-ink">{row.phone || '—'}</td>
                      <td className="py-1.5 pr-3 text-ink">{row.email || '—'}</td>
                      <td className="py-1.5 pr-3 text-ink">{row.company || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {mappedRows.length > 5 && <p className="mt-2 text-xs text-muted">+ {mappedRows.length - 5} more</p>}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button onClick={reset} className={btn}>Start over</button>
            <button onClick={runImport} disabled={importing} className={btnAccent}>
              {importing ? 'Importing…' : `Import ${mappedRows.length} contact${mappedRows.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      )}

      {step === 'result' && result && (
        <div className="space-y-5">
          <div className={card}>
            <h2 className={h2}>Import complete</h2>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-lg bg-starboard/10 p-4">
                <div className="text-2xl font-bold text-starboard">{result.imported}</div>
                <div className="text-xs text-muted">Imported</div>
              </div>
              <div className="rounded-lg bg-canvas p-4">
                <div className="text-2xl font-bold text-ink">{result.skipped}</div>
                <div className="text-xs text-muted">Skipped (duplicate)</div>
              </div>
              <div className="rounded-lg bg-red-50 p-4">
                <div className="text-2xl font-bold text-port">{result.failed.length}</div>
                <div className="text-xs text-muted">Failed</div>
              </div>
            </div>
            {result.failed.length > 0 && (
              <div className="mt-4">
                <p className="text-sm text-port">{result.failed.length} row{result.failed.length === 1 ? '' : 's'} couldn't be saved.</p>
                <button onClick={() => downloadFailedRows(result.failed)} className={`${btn} mt-2`}>
                  Download failed rows
                </button>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={reset} className={btn}>Import another file</button>
            <button onClick={() => navigate('/contacts')} className={btnAccent}>Go to Contacts</button>
          </div>
        </div>
      )}
    </div>
  )
}

function UploadCard({ title, description, accept, onSelect, busy }) {
  return (
    <label className={`${card} flex cursor-pointer flex-col items-center gap-2 text-center hover:border-accent ${busy ? 'pointer-events-none opacity-60' : ''}`}>
      <span className="text-3xl">📇</span>
      <span className="font-semibold text-ink">{title}</span>
      <span className="text-xs text-muted">{description}</span>
      <span className={`${btnAccent} mt-2`}>{busy ? 'Reading…' : 'Choose file'}</span>
      <input type="file" accept={accept} onChange={onSelect} className="hidden" disabled={busy} />
    </label>
  )
}
