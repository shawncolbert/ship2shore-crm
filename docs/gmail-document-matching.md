# Auto-matching Delivery Orders & gate-pass PDFs from Gmail

The scheduled `gmail-sync` Edge Function (cron: every 15 min) now also scans new
emails for **Delivery Order** and **Ports America gate-pass** PDF attachments,
matches them to a job, and files them — no manual step to run it.

## Flow (all automatic)

```
gmail-sync (every 15 min)
  → for each recent email, walk its PDF attachments
  → download the PDF, pull its embedded text (unpdf; best-effort)
  → decide from the ATTACHMENT ITSELF (filename + its own PDF text):
       • is it a Delivery Order / gate pass?      (classifyKind)
       • does it carry a job's number?            (matchOpportunity)
  → store the PDF in the delivery-orders bucket + attachments table
       • matched  → linked to that job + contact
       • unmatched but clearly a DO/gate pass → flagged needs_review = true
       • neither  → ignored (not stored)
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
| Scan email for DO / gate-pass PDFs, on schedule | ✅ Automatic (cron, every 15 min) |
| Extract embedded text + BL number | ✅ Automatic (text-layer PDFs) |
| Match to a job by billing_number / bl_number | ✅ Automatic |
| Store the PDF and link it to the job/contact | ✅ Automatic |
| Flag unmatched documents | ✅ Automatic |
| **Link an unmatched document to the right job** | 🖐 Manual (Documents page) |
| **Read an image-only / scanned PDF with no text layer** | 🖐 Not supported in the edge runtime (no OCR). It's still stored from its filename and flagged for review. |

## Schema

See `supabase/migrations/0002_doc_matching_bl_number_and_review.sql`:
`opportunities.bl_number`, plus `attachments.bl_number / needs_review / source /
provider_msg_id` and a `(provider_msg_id, file_name)` dedupe index.
