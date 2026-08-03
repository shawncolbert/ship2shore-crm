import { supabase } from './_shared/supabase.js'

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const handler = async (event) => {
  const slug = event.queryStringParameters?.slug

  if (!slug) return json(400, { error: 'Slug required' })

  // Get published funnel by slug
  const { data: funnel, error: funnelErr } = await supabase
    .from('funnels')
    .select('id, name, description, slug, published')
    .eq('slug', slug)
    .eq('published', true)
    .single()

  if (funnelErr || !funnel) return json(404, { error: 'Funnel not found' })

  // Get steps
  const { data: steps, error: stepsErr } = await supabase
    .from('funnel_steps')
    .select('id, step_number, title, description, fields')
    .eq('funnel_id', funnel.id)
    .order('step_number', { ascending: true })

  if (stepsErr) return json(500, { error: stepsErr.message })

  return json(200, { funnel: { ...funnel, steps } })
}
