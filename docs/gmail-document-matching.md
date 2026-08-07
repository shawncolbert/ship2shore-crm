# Auto-matching Delivery Orders & gate-pass docs from Gmail

The scheduled `gmail-sync` Edge Function (cron: every 15 min) now also scans new
emails for **Delivery Order** and **Ports America gate-pass** attachments —
PDFs and photos (jpg/png/heic) alike — matches them to a job, and files them —
no manual step to run it.

> Photos used to be invisible to this entirely: only `.pdf` attachments were
> ever looked at, so a customer photographing a delivery order with their
> phone (very common) produced no record at all — not even a "review" flag,
> it just vanished. Fixed: image attachments are now collected the same as
> PDFs. There's no OCR in the edge runtime, so a photo can only auto-match a
> job by its **filename** carrying the job's billing/BL number — but unlike
> PDFs, an unmatched photo is never silently dropped: it's always stored and
> flagged `needs_review` so a dispatcher can link it by hand from the
> Documents page instead of it disappearing.

## Flow (all automatic)

```
gmail-sync (every 15 min)
  → for each recent email, walk its PDF and image (jpg/png/heic) attachments
  → PDF: download it, pull its embedded text (unpdf; best-effort)
  → image: no text extraction possible (no OCR in the edge runtime) — filename only
  → decide from the ATTACHMENT ITSELF (filename + its own PDF text, when it has one):
       • is it a Delivery Order / gate pass?      (classifyKind)
       • does it carry a job's number?            (matchOpportunity)
  → store it in the delivery-orders bucket + attachments table
       • matched  → linked to that job + contact
       • unmatched but clearly a DO/gate pass (PDF) → flagged needs_review = true
       • unmatched image → ALWAYS flagged needs_review = true (never dropped)
       • unmatched, unclassified PDF → ignored (not stored) -- these are almost
         always unrelated customs paperwork (7501s, ABI messages, etc.)
  → extract a BL/booking number (e.g. MOLU18009201655) → attachments.bl_number,
    and backfill the job's opportunities.bl_number if it had none
```

Classification/matching deliberately use only each attachment's own text, **not**
the shared email subject/body, so an email that merely mentions "delivery order"
doesn't drag in every unrelated customs PDF (7501, ABI messages, etc.).

## Matching logic

A document matches a job when the job's `billing_number` or `bl_number`
(normalized, ≥6 chars) appears in the document's text. So the moment a
dispatcher types a ship billing # / BL on a pipeline card, future documents
carrying that number attach themselves automatically.

## Reviewing unmatched documents

Unmatched DOs/gate passes are flagged and appear on the new **Documents** page
(sidebar → Documents). Each can be **Linked** to a job (which also clears the
flag and files it on that job/contact) or **Dismissed** (deletes it).

## What's automatic vs. manual

| Step | Automatic? |
|------|------------|
| Scan email for DO / gate-pass PDFs **and photos**, on schedule | ✅ Automatic (cron, every 15 min) |
| Extract embedded text + BL number | ✅ Automatic (text-layer PDFs only) |
| Match to a job by billing_number / bl_number | ✅ Automatic (PDF text, or a photo's filename) |
| Store the doc and link it to the job/contact | ✅ Automatic |
| Flag unmatched documents for review | ✅ Automatic — **always** for photos, and for PDFs recognized as a DO/gate pass |
| **Link an unmatched document to the right job** | 🖐 Manual (Documents page) |
| **Read the actual contents of a photo or scanned/image-only PDF** | 🖐 Not supported in the edge runtime (no OCR). It's still stored and flagged for review — just matched/named from its filename, not its contents. |

## Schema

See `supabase/migrations/0002_doc_matching_bl_number_and_review.sql`:
`opportunities.bl_number`, plus `attachments.bl_number / needs_review / source /
provider_msg_id` and a `(provider_msg_id, file_name)` dedupe index.
