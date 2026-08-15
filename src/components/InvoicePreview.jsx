const money = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n || 0))
const fmtDate = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '—')

// Pure presentational, no data fetching -- used both as the live preview in
// the invoice builder (fed uncommitted form state) and as the read-only
// customer-facing public invoice page. Deliberately matches the layout of
// the Wave invoice this replaces: logo top-left, business info top-right,
// Bill To / Ship To / invoice meta row, red services table header, totals
// block, notes/terms footer -- so switching off Wave doesn't mean handing
// customers something that looks like a downgrade.
export default function InvoicePreview({ businessInfo, invoice, lineItems, paymentOptions }) {
  const bizName = businessInfo?.invoice_business_name || businessInfo?.name || 'Your Business'
  const linkOptions = (paymentOptions || []).filter((o) => o.kind === 'link')
  const handleOptions = (paymentOptions || []).filter((o) => o.kind === 'handle')

  return (
    <div className="mx-auto w-full max-w-3xl rounded-lg border border-line bg-white p-8 text-slate-900 shadow-sm">
      {(linkOptions.length > 0 || handleOptions.length > 0) && invoice?.status !== 'paid' && (
        <div className="mb-6 rounded-lg bg-emerald-50 px-4 py-3">
          <p className="text-sm text-emerald-800">This invoice is ready for payment.</p>
          {linkOptions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {linkOptions.map((o) => (
                <a key={o.method} href={o.url} className="shrink-0 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-bold text-white hover:bg-emerald-700">
                  Pay with {o.label}
                </a>
              ))}
            </div>
          )}
          {handleOptions.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-sm text-emerald-800">
              {handleOptions.map((o) => (
                <li key={o.method}><strong>{o.label}:</strong> {o.handle}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {invoice?.status === 'paid' && (
        <div className="mb-6 rounded-lg bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">✓ Paid in full</div>
      )}
      {/* Header: logo + business info */}
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="shrink-0">
          {businessInfo?.logo_url ? (
            <img src={businessInfo.logo_url} alt="" className="h-24 w-24 object-contain" />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-full border-2 border-slate-300 text-xs font-semibold text-slate-400">
              LOGO
            </div>
          )}
        </div>
        <div className="text-right">
          <h1 className="text-3xl font-bold tracking-wide text-slate-800">INVOICE</h1>
          <p className="mt-2 text-sm font-bold text-slate-800">{bizName}</p>
          {businessInfo?.invoice_business_address && (
            <p className="whitespace-pre-line text-sm text-slate-600">{businessInfo.invoice_business_address}</p>
          )}
          {businessInfo?.invoice_business_phone && <p className="mt-1 text-sm text-slate-600">Phone: {businessInfo.invoice_business_phone}</p>}
          {businessInfo?.invoice_business_website && <p className="text-sm text-slate-600">{businessInfo.invoice_business_website}</p>}
        </div>
      </div>

      {/* Bill To / Ship To / meta */}
      <div className="mt-6 grid gap-4 border-t border-slate-200 pt-4 text-sm sm:grid-cols-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Bill to</p>
          {invoice?.bill_to_name && <p className="whitespace-pre-line font-semibold text-slate-800">{invoice.bill_to_name}</p>}
          {invoice?.bill_to_address && <p className="whitespace-pre-line text-slate-600">{invoice.bill_to_address}</p>}
          {invoice?.bill_to_phone && <p className="mt-1 text-slate-600">{invoice.bill_to_phone}</p>}
          {invoice?.bill_to_email && <p className="text-slate-600">{invoice.bill_to_email}</p>}
        </div>
        <div>
          {(invoice?.ship_to_name || invoice?.ship_to_address) && (
            <>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ship to</p>
              {invoice?.ship_to_name && <p className="font-semibold text-slate-800">{invoice.ship_to_name}</p>}
              {invoice?.ship_to_address && <p className="whitespace-pre-line text-slate-600">{invoice.ship_to_address}</p>}
              {invoice?.ship_to_phone && <p className="mt-1 text-slate-600">{invoice.ship_to_phone}</p>}
            </>
          )}
        </div>
        <div className="space-y-1">
          <MetaRow label="Invoice Number" value={invoice?.invoice_number} />
          {invoice?.po_number && <MetaRow label="P.O./S.O. Number" value={invoice.po_number} />}
          <MetaRow label="Invoice Date" value={fmtDate(invoice?.invoice_date)} />
          <MetaRow label="Payment Due" value={fmtDate(invoice?.due_date)} />
          <MetaRow label="Amount Due (USD)" value={money(invoice?.amount_due)} strong />
        </div>
      </div>

      {/* Line items */}
      <table className="mt-6 w-full border-collapse text-sm">
        <thead>
          <tr className="bg-red-600 text-left text-white">
            <th className="px-3 py-2 font-semibold">Services</th>
            <th className="px-3 py-2 text-right font-semibold">Quantity</th>
            <th className="px-3 py-2 text-right font-semibold">Price</th>
            <th className="px-3 py-2 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {(lineItems || []).map((li, i) => (
            <tr key={li.id || i} className="border-b border-slate-100">
              <td className="px-3 py-2 text-slate-800">{li.description}</td>
              <td className="px-3 py-2 text-right text-slate-600">{li.quantity}</td>
              <td className="px-3 py-2 text-right text-slate-600">{money(li.unit_price)}</td>
              <td className="px-3 py-2 text-right text-slate-800">{money((Number(li.quantity) || 0) * (Number(li.unit_price) || 0))}</td>
            </tr>
          ))}
          {(!lineItems || lineItems.length === 0) && (
            <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-400">No line items yet.</td></tr>
          )}
        </tbody>
      </table>

      {/* Totals */}
      <div className="mt-4 flex justify-end">
        <div className="w-full max-w-xs space-y-1 text-sm">
          <div className="flex justify-between border-t border-slate-200 pt-2 font-semibold text-slate-800">
            <span>Total:</span><span>{money(invoice?.total)}</span>
          </div>
          {invoice?.status === 'paid' && (
            <div className="flex justify-between border-b border-slate-200 pb-2 text-slate-600">
              <span>Payment{invoice?.paid_at ? ` on ${fmtDate(invoice.paid_at.slice(0, 10))}` : ''}{invoice?.payment_method ? ` via ${invoice.payment_method}` : ''}:</span>
              <span>{money(invoice.total)}</span>
            </div>
          )}
          <div className="flex justify-between pt-1 font-bold text-slate-900">
            <span>Amount Due (USD):</span><span>{money(invoice?.amount_due)}</span>
          </div>
        </div>
      </div>

      {invoice?.notes && (
        <div className="mt-8 border-t border-slate-200 pt-4 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Notes / Terms</p>
          <p className="mt-1 whitespace-pre-line text-slate-600">{invoice.notes}</p>
        </div>
      )}
    </div>
  )
}

function MetaRow({ label, value, strong }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? 'rounded bg-slate-50 px-2 py-1' : ''}`}>
      <span className="text-slate-500">{label}:</span>
      <span className={strong ? 'font-bold text-slate-900' : 'font-medium text-slate-800'}>{value}</span>
    </div>
  )
}
