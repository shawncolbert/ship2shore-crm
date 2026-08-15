import { admin } from './supabaseAdmin.js'

export async function getDefaultPipeline(orgId) {
  const { data } = await admin
    .from('pipelines')
    .select('id')
    .eq('org_id', orgId)
    .eq('is_default', true)
    .single()
  return data
}

export async function getStageByName(orgId, stageName) {
  const pipeline = await getDefaultPipeline(orgId)
  if (!pipeline) return null

  const { data } = await admin
    .from('stages')
    .select('id, name')
    .eq('pipeline_id', pipeline.id)

  if (!data) return null

  const stage = data.find(s => s.name.toLowerCase() === stageName.toLowerCase())
  return stage || null
}

// The stage new bookings/leads should land in, for an org whose stage
// names this code doesn't control. Prefers the explicit is_intake flag
// (set via the pipeline stages admin UI) so a stage can be named anything
// -- "New Lead", "New Inquiry", whatever fits the business -- and falls
// back to a "New Booking" name match only for orgs that predate the flag.
export async function getIntakeStage(orgId) {
  const pipeline = await getDefaultPipeline(orgId)
  if (!pipeline) return null

  const { data } = await admin
    .from('stages')
    .select('id, name, is_intake')
    .eq('pipeline_id', pipeline.id)

  if (!data || data.length === 0) return null

  return (
    data.find((s) => s.is_intake) ||
    data.find((s) => s.name.toLowerCase() === 'new booking') ||
    null
  )
}

// This org's actual pipeline stage names, in board order -- for anything
// (like the AI assistant's tool schemas) that needs to offer/validate a
// closed set of stage choices without assuming what those stages are
// called, since stage names are org-defined, not fixed by this codebase.
export async function listStageNames(orgId) {
  const pipeline = await getDefaultPipeline(orgId)
  if (!pipeline) return []

  const { data } = await admin
    .from('stages')
    .select('name')
    .eq('pipeline_id', pipeline.id)
    .order('position', { ascending: true })

  return (data || []).map((s) => s.name)
}
