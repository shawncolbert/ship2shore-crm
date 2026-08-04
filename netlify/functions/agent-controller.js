import { admin, userFromToken, orgForUser } from './_shared/supabaseAdmin.js'
import Anthropic from '@anthropic-ai/sdk'

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

const AGENT_TOOLS = [
  {
    name: 'create_contact',
    description: 'Creates a new contact in the CRM',
    input_schema: {
      type: 'object',
      properties: {
        full_name: { type: 'string', description: 'Full name' },
        email: { type: 'string', description: 'Email address' },
        phone: { type: 'string', description: 'Phone number (optional)' },
        company: { type: 'string', description: 'Company name (optional)' },
      },
      required: ['full_name', 'email'],
    },
  },
  {
    name: 'create_opportunity',
    description: 'Creates a new deal/opportunity linked to a contact',
    input_schema: {
      type: 'object',
      properties: {
        contact_id: { type: 'string', description: 'ID of the contact' },
        title: { type: 'string', description: 'Deal title' },
        deal_value: { type: 'number', description: 'Deal value in USD' },
        stage: {
          type: 'string',
          enum: ['lead', 'qualified', 'proposal', 'negotiation', 'closed_won', 'closed_lost'],
          description: 'Pipeline stage',
        },
      },
      required: ['contact_id', 'title', 'stage'],
    },
  },
  {
    name: 'search_contacts',
    description: 'Search contacts by name, email, or company',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_pipeline_summary',
    description: 'Get deal count and value breakdown by pipeline stage',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'navigate_page',
    description: 'Navigate the UI to a specific page',
    input_schema: {
      type: 'object',
      properties: {
        route: { type: 'string', description: 'Route path (e.g., /pipeline, /contacts)' },
      },
      required: ['route'],
    },
  },
  {
    name: 'update_opportunity_stage',
    description: 'Move an opportunity to a different pipeline stage',
    input_schema: {
      type: 'object',
      properties: {
        opportunity_id: { type: 'string', description: 'ID of the opportunity to move' },
        stage: {
          type: 'string',
          enum: ['lead', 'qualified', 'proposal', 'negotiation', 'closed_won', 'closed_lost'],
          description: 'New pipeline stage',
        },
      },
      required: ['opportunity_id', 'stage'],
    },
  },
  {
    name: 'delete_opportunity',
    description: 'Delete an opportunity/deal from the pipeline',
    input_schema: {
      type: 'object',
      properties: {
        opportunity_id: { type: 'string', description: 'ID of the opportunity to delete' },
      },
      required: ['opportunity_id'],
    },
  },
  {
    name: 'delete_contact',
    description: 'Delete a contact from the CRM',
    input_schema: {
      type: 'object',
      properties: {
        contact_id: { type: 'string', description: 'ID of the contact to delete' },
      },
      required: ['contact_id'],
    },
  },
  {
    name: 'get_outstanding_revenue',
    description: 'Calculate total amount still owed by customers (deals not closed)',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'update_opportunity',
    description: 'Update any field on an opportunity/deal card (title, value, payment status, notes, etc.)',
    input_schema: {
      type: 'object',
      properties: {
        opportunity_id: { type: 'string', description: 'ID of the opportunity' },
        title: { type: 'string', description: 'Deal title/name' },
        value: { type: 'number', description: 'Deal value in USD' },
        stage: {
          type: 'string',
          enum: ['lead', 'qualified', 'proposal', 'negotiation', 'closed_won', 'closed_lost'],
          description: 'Pipeline stage',
        },
      },
      required: ['opportunity_id'],
    },
  },
  {
    name: 'update_contact',
    description: 'Update contact details (name, email, phone, company)',
    input_schema: {
      type: 'object',
      properties: {
        contact_id: { type: 'string', description: 'ID of the contact' },
        full_name: { type: 'string', description: 'Full name' },
        email: { type: 'string', description: 'Email address' },
        phone: { type: 'string', description: 'Phone number' },
        company: { type: 'string', description: 'Company name' },
      },
      required: ['contact_id'],
    },
  },
]

async function executeTool(toolName, input, orgId) {
  switch (toolName) {
    case 'create_contact': {
      const { data: newContact, error } = await admin
        .from('contacts')
        .insert({
          org_id: orgId,
          full_name: input.full_name,
          email: input.email,
          phone: input.phone || null,
          company: input.company || null,
          tags: ['ai-created'],
        })
        .select()
        .single()

      if (error) throw new Error(error.message)
      return {
        result: newContact,
        clientEvent: { type: 'CONTACT_ADDED', data: newContact },
      }
    }

    case 'create_opportunity': {
      const { data: opportunity, error } = await admin
        .from('opportunities')
        .insert({
          org_id: orgId,
          contact_id: input.contact_id,
          pipeline_id: (await getDefaultPipeline(orgId))?.id,
          stage_id: (await getStageByName(orgId, input.stage))?.id,
          title: input.title,
          value: input.deal_value || null,
        })
        .select()
        .single()

      if (error) throw new Error(error.message)
      return {
        result: opportunity,
        clientEvent: { type: 'OPPORTUNITY_ADDED', data: opportunity },
      }
    }

    case 'search_contacts': {
      const { data: contacts, error } = await admin
        .from('contacts')
        .select('id, full_name, email, company')
        .eq('org_id', orgId)
        .or(`full_name.ilike.%${input.query}%,email.ilike.%${input.query}%,company.ilike.%${input.query}%`)
        .limit(5)

      if (error) throw new Error(error.message)
      return { result: contacts || [], clientEvent: null }
    }

    case 'get_pipeline_summary': {
      const { data: opportunities, error } = await admin
        .from('opportunities')
        .select('stage_id, value')
        .eq('org_id', orgId)

      if (error) throw new Error(error.message)

      const summary = {}
      opportunities?.forEach((opp) => {
        if (!summary[opp.stage_id]) summary[opp.stage_id] = { count: 0, value: 0 }
        summary[opp.stage_id].count += 1
        summary[opp.stage_id].value += opp.value || 0
      })

      return { result: summary, clientEvent: null }
    }

    case 'navigate_page': {
      return {
        result: { status: 'navigating', route: input.route },
        clientEvent: { type: 'REDIRECT', route: input.route },
      }
    }

    case 'update_opportunity_stage': {
      const stageId = (await getStageByName(orgId, input.stage))?.id
      if (!stageId) throw new Error(`Stage "${input.stage}" not found`)

      const { error } = await admin
        .from('opportunities')
        .update({ stage_id: stageId })
        .eq('id', input.opportunity_id)
        .eq('org_id', orgId)

      if (error) throw new Error(error.message)
      return {
        result: { status: 'updated', stage: input.stage },
        clientEvent: { type: 'OPPORTUNITY_UPDATED', data: { opportunityId: input.opportunity_id, stage: input.stage } },
      }
    }

    case 'delete_opportunity': {
      const { error } = await admin
        .from('opportunities')
        .delete()
        .eq('id', input.opportunity_id)
        .eq('org_id', orgId)

      if (error) throw new Error(error.message)
      return {
        result: { status: 'deleted', opportunityId: input.opportunity_id },
        clientEvent: { type: 'OPPORTUNITY_DELETED', data: { opportunityId: input.opportunity_id } },
      }
    }

    case 'delete_contact': {
      const { error } = await admin
        .from('contacts')
        .delete()
        .eq('id', input.contact_id)
        .eq('org_id', orgId)

      if (error) throw new Error(error.message)
      return {
        result: { status: 'deleted', contactId: input.contact_id },
        clientEvent: { type: 'CONTACT_DELETED', data: { contactId: input.contact_id } },
      }
    }

    case 'get_outstanding_revenue': {
      // Get all opportunities that aren't closed (won or lost)
      const { data: opportunities, error } = await admin
        .from('opportunities')
        .select('id, title, value, stage_id')
        .eq('org_id', orgId)

      if (error) throw new Error(error.message)

      // Get all stages to find which ones are "closed"
      const { data: stages } = await admin.from('stages').select('id, name')

      const closedStageNames = ['closed_won', 'closed_lost']
      const closedStageIds = stages?.filter(s => closedStageNames.includes(s.name.toLowerCase()))?.map(s => s.id) || []

      // Filter to only open deals
      const openOpportunities = opportunities?.filter(opp => !closedStageIds.includes(opp.stage_id)) || []
      const totalOutstanding = openOpportunities.reduce((sum, opp) => sum + (opp.value || 0), 0)

      return {
        result: {
          totalOutstanding,
          dealCount: openOpportunities.length,
          deals: openOpportunities.map(opp => ({ id: opp.id, title: opp.title, value: opp.value })),
        },
        clientEvent: null,
      }
    }

    case 'update_opportunity': {
      const updateData = {}
      if (input.title) updateData.title = input.title
      if (input.value !== undefined) updateData.value = input.value
      if (input.stage) {
        const stageId = (await getStageByName(orgId, input.stage))?.id
        if (stageId) updateData.stage_id = stageId
      }

      if (Object.keys(updateData).length === 0) {
        throw new Error('No fields to update')
      }

      const { data: updated, error } = await admin
        .from('opportunities')
        .update(updateData)
        .eq('id', input.opportunity_id)
        .eq('org_id', orgId)
        .select()
        .single()

      if (error) throw new Error(error.message)

      return {
        result: updated,
        clientEvent: { type: 'OPPORTUNITY_UPDATED', data: updated },
      }
    }

    case 'update_contact': {
      const updateData = {}
      if (input.full_name) updateData.full_name = input.full_name
      if (input.email) updateData.email = input.email
      if (input.phone) updateData.phone = input.phone
      if (input.company) updateData.company = input.company

      if (Object.keys(updateData).length === 0) {
        throw new Error('No fields to update')
      }

      const { data: updated, error } = await admin
        .from('contacts')
        .update(updateData)
        .eq('id', input.contact_id)
        .eq('org_id', orgId)
        .select()
        .single()

      if (error) throw new Error(error.message)

      return {
        result: updated,
        clientEvent: { type: 'CONTACT_UPDATED', data: updated },
      }
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`)
  }
}

async function getDefaultPipeline(orgId) {
  const { data } = await admin
    .from('pipelines')
    .select('id')
    .eq('org_id', orgId)
    .eq('is_default', true)
    .single()
  return data
}

async function getStageByName(orgId, stageName) {
  // Map stage names to actual stage IDs
  // For now, get first stage of default pipeline
  const pipeline = await getDefaultPipeline(orgId)
  if (!pipeline) return null

  const { data } = await admin
    .from('stages')
    .select('id')
    .eq('pipeline_id', pipeline.id)
    .order('position', { ascending: true })
    .limit(1)
    .single()
  return data
}

export const handler = async (event) => {
  try {
    const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
    const user = await userFromToken(token)
    if (!user) return json(401, { error: 'Unauthorized' })

    const orgId = await orgForUser(user.id)
    if (!orgId) return json(403, { error: 'No organization' })

    const { userPrompt, conversationHistory = [] } = JSON.parse(event.body || '{}')
    if (!userPrompt) return json(400, { error: 'User prompt required' })

    const messages = [...conversationHistory, { role: 'user', content: userPrompt }]
    const clientEvents = []

    // Agentic loop
    let loopCount = 0
    const MAX_LOOPS = 10
    let finalReply = ''

    while (loopCount < MAX_LOOPS) {
      loopCount++

      const response = await anthropic.messages.create({
        model: 'claude-opus-5',
        max_tokens: 1024,
        system:
          'You are a helpful CRM assistant. Use tools to help users manage their sales pipeline, contacts, and opportunities. Be concise and friendly.',
        tools: AGENT_TOOLS,
        messages,
      })

      messages.push({ role: 'assistant', content: response.content })

      if (response.stop_reason === 'end_turn') {
        finalReply = response.content.find((b) => b.type === 'text')?.text || 'Done'
        break
      }

      if (response.stop_reason === 'tool_use') {
        const toolResults = []

        for (const block of response.content) {
          if (block.type === 'tool_use') {
            const { result, clientEvent } = await executeTool(block.name, block.input, orgId)

            if (clientEvent) clientEvents.push(clientEvent)

            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(result),
            })
          }
        }

        messages.push({ role: 'user', content: toolResults })
      }
    }

    return json(200, {
      reply: finalReply,
      conversationHistory: messages,
      clientEvents,
    })
  } catch (e) {
    console.error(e)
    return json(500, { error: e.message })
  }
}
