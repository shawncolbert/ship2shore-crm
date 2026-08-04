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
