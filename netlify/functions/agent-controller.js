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

// Ship2Shore Pricing Structure
const SHIP2SHORE_PRICING = {
  zones: {
    'LA Local': { min: 275, max: 325, areas: ['Los Angeles', 'Santa Monica', 'West LA'] },
    'Orange County': { min: 300, max: 350, areas: ['Anaheim', 'Long Beach area', 'Orange County'] },
    'Ventura County': { min: 325, max: 375, areas: ['Ventura', 'Oxnard', 'Ojai'] },
    'Valencia/Santa Clarita': { min: 350, max: 400, areas: ['Valencia', 'Santa Clarita', 'Castaic'] },
    'Riverside/San Bernardino': { min: 400, max: 475, areas: ['Riverside', 'San Bernardino', 'Ontario'] },
    'San Diego': { min: 600, max: 675, areas: ['San Diego', 'Oceanside', 'Carlsbad'] },
    'Northern CA': { min: 625, max: 725, areas: ['Sacramento', 'Bay Area', 'Northern California'] },
  },
  services: {
    twic_escort: { name: 'TWIC Vehicle Escort', standard: 95, military: 80 },
    hotshot: { name: 'Hotshot Delivery', flat: 200 },
    semi_container: { name: 'Semi/Container (Tractor-Trailer)', flat: 325 },
  },
  surcharges: {
    'non-operating': 200,
    'winching': 125,
    'oversized': 125,
    'lifted': { min: 125, max: 175 },
  },
  ports: {
    wilmington_norton_lilly: {
      name: 'Wilmington (Norton Lilly)',
      services: [
        { item: 'Terminal handling', rate: 83, unit: 'per vehicle', hh_rate: 93 },
        { item: 'BL Processing', rate: 50, unit: 'per BL' },
        { item: 'Local Wharfage', rate: 31, unit: 'per vehicle' },
        { item: 'Service & Facilities', rate: 20, unit: 'per unit' },
      ],
    },
    wilmington_ports_america: {
      name: 'Wilmington (Ports America gate storage)',
      services: [
        { item: 'Passenger storage', rate: 30, unit: 'per vehicle per day' },
        { item: 'Commercial/HH storage', rate: 19.65, unit: 'per MT per day' },
        { item: 'Card processing', rate: 3, unit: 'percent' },
        { item: 'Non-TWIC security escort', rate: 100, unit: 'flat' },
      ],
    },
    long_beach_ssa: {
      name: 'Long Beach (SSA Marine)',
      note: 'Rates pending confirmation from Shawn',
    },
    matson: {
      name: 'Matson',
      note: 'Rates pending confirmation from Shawn',
    },
  },
}

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
    name: 'get_contact_opportunities',
    description: 'Get all opportunities/deals for a specific contact',
    input_schema: {
      type: 'object',
      properties: {
        contact_id: { type: 'string', description: 'ID of the contact' },
      },
      required: ['contact_id'],
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
  {
    name: 'add_service_item_to_opportunity',
    description: 'Add a line item service/fee to a job. Ship2Shore services: escort ($75-$95), storage ($16-$700), hotshot ($200), big_rig ($325)',
    input_schema: {
      type: 'object',
      properties: {
        opportunity_id: { type: 'string', description: 'ID of the opportunity/job' },
        service_type: {
          type: 'string',
          enum: ['escort', 'storage', 'hotshot', 'big_rig', 'other'],
          description: 'Type of service',
        },
        description: { type: 'string', description: 'e.g., "Single car escort", "5-day storage", "2 car escorts"' },
        quantity: { type: 'number', description: 'Quantity (e.g., 2 cars, 5 days storage)' },
        unit_price: { type: 'number', description: 'Price per unit in USD' },
      },
      required: ['opportunity_id', 'service_type', 'quantity', 'unit_price'],
    },
  },
  {
    name: 'get_opportunity_items',
    description: 'Get all line item services/fees for a job',
    input_schema: {
      type: 'object',
      properties: {
        opportunity_id: { type: 'string', description: 'ID of the opportunity/job' },
      },
      required: ['opportunity_id'],
    },
  },
  {
    name: 'update_opportunity_total_from_items',
    description: 'Recalculate opportunity total value by summing all line items',
    input_schema: {
      type: 'object',
      properties: {
        opportunity_id: { type: 'string', description: 'ID of the opportunity/job' },
      },
      required: ['opportunity_id'],
    },
  },
  {
    name: 'generate_quote',
    description: 'Generate a detailed Ship2Shore quote with services and surcharges',
    input_schema: {
      type: 'object',
      properties: {
        zone: {
          type: 'string',
          enum: ['LA Local', 'Orange County', 'Ventura County', 'Valencia/Santa Clarita', 'Riverside/San Bernardino', 'San Diego', 'Northern CA'],
          description: 'Geographic zone for pricing',
        },
        service_type: {
          type: 'string',
          enum: ['twic_escort', 'hotshot', 'semi_container'],
          description: 'Type of service',
        },
        quantity: { type: 'number', description: 'Number of vehicles/units (for escort, number of cars)' },
        is_military: { type: 'boolean', description: 'Is this a military/PCS job? (applies $80 rate instead of $95 for escort)' },
        surcharges: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['non-operating', 'winching', 'oversized', 'lifted'],
          },
          description: 'Any applicable surcharges',
        },
        notes: { type: 'string', description: 'Additional notes about the job' },
      },
      required: ['zone', 'service_type', 'quantity'],
    },
  },
  {
    name: 'get_pricing_info',
    description: 'Get all Ship2Shore pricing information (zones, services, surcharges, ports)',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'edit_deal_value',
    description: 'Edit the value/price of a pipeline deal. Can set exact amount or adjust by percentage.',
    input_schema: {
      type: 'object',
      properties: {
        opportunity_id: { type: 'string', description: 'ID of the deal/opportunity to edit' },
        new_value: { type: 'number', description: 'New exact value in USD (e.g., 5000 for $5,000)' },
        adjust_by_percent: { type: 'number', description: 'Alternative: adjust current value by percent (e.g., 10 for +10%, -15 for -15%)' },
      },
      required: ['opportunity_id'],
      oneOf: [
        { required: ['opportunity_id', 'new_value'] },
        { required: ['opportunity_id', 'adjust_by_percent'] },
      ],
    },
  },
  {
    name: 'send_email',
    description: 'Send an email to a customer with a specific message type (delivery order request or payment link request)',
    input_schema: {
      type: 'object',
      properties: {
        customer_email: { type: 'string', description: 'Customer email address' },
        customer_name: { type: 'string', description: 'Customer name' },
        message_type: {
          type: 'string',
          enum: ['delivery_order_request', 'payment_link_request'],
          description: 'Type of message to send',
        },
        booking_amount: { type: 'number', description: 'Booking amount in USD (for payment link requests)' },
        booking_details: { type: 'string', description: 'Booking details to include in the email' },
      },
      required: ['customer_email', 'customer_name', 'message_type'],
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

    case 'get_contact_opportunities': {
      const { data: opportunities, error } = await admin
        .from('opportunities')
        .select('id, title, value, stage_id, contact_id')
        .eq('contact_id', input.contact_id)
        .eq('org_id', orgId)

      if (error) throw new Error(error.message)
      return { result: opportunities || [], clientEvent: null }
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
      if (!input.opportunity_id) throw new Error('opportunity_id is required')

      const updateData = {}
      if (input.title) updateData.title = input.title
      if (input.value !== undefined) {
        const numValue = typeof input.value === 'string' ? parseFloat(input.value.replace(/[^\d.]/g, '')) : input.value
        if (!isNaN(numValue)) updateData.value = numValue
      }
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

      if (error) throw new Error(`Failed to update opportunity: ${error.message}`)
      if (!updated) throw new Error('Opportunity not found or not accessible')

      return {
        result: updated,
        clientEvent: { type: 'OPPORTUNITY_UPDATED', data: updated },
      }
    }

    case 'update_contact': {
      if (!input.contact_id) throw new Error('contact_id is required')

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

      if (error) throw new Error(`Failed to update contact: ${error.message}`)
      if (!updated) throw new Error('Contact not found or not accessible')

      return {
        result: updated,
        clientEvent: { type: 'CONTACT_UPDATED', data: updated },
      }
    }

    case 'add_service_item_to_opportunity': {
      if (!input.opportunity_id) throw new Error('opportunity_id is required')

      const totalPrice = (input.quantity || 1) * (input.unit_price || 0)

      const { data: item, error } = await admin
        .from('opportunity_items')
        .insert({
          org_id: orgId,
          opportunity_id: input.opportunity_id,
          service_type: input.service_type,
          description: input.description || null,
          quantity: input.quantity || 1,
          unit_price: input.unit_price,
          total_price: totalPrice,
        })
        .select()
        .single()

      if (error) throw new Error(`Failed to add service item: ${error.message}`)

      return {
        result: item,
        clientEvent: { type: 'OPPORTUNITY_UPDATED', data: { opportunityId: input.opportunity_id } },
      }
    }

    case 'get_opportunity_items': {
      const { data: items, error } = await admin
        .from('opportunity_items')
        .select('*')
        .eq('opportunity_id', input.opportunity_id)
        .eq('org_id', orgId)
        .order('created_at', { ascending: true })

      if (error) throw new Error(`Failed to get items: ${error.message}`)

      const total = (items || []).reduce((sum, item) => sum + (item.total_price || 0), 0)

      return {
        result: {
          items: items || [],
          total,
          itemCount: (items || []).length,
        },
        clientEvent: null,
      }
    }

    case 'update_opportunity_total_from_items': {
      // Get all items for this opportunity
      const { data: items, error: itemsErr } = await admin
        .from('opportunity_items')
        .select('total_price')
        .eq('opportunity_id', input.opportunity_id)
        .eq('org_id', orgId)

      if (itemsErr) throw new Error(`Failed to get items: ${itemsErr.message}`)

      // Calculate total
      const total = (items || []).reduce((sum, item) => sum + (item.total_price || 0), 0)

      // Update opportunity value
      const { data: updated, error: updateErr } = await admin
        .from('opportunities')
        .update({ value: total })
        .eq('id', input.opportunity_id)
        .eq('org_id', orgId)
        .select()
        .single()

      if (updateErr) throw new Error(`Failed to update opportunity: ${updateErr.message}`)

      return {
        result: {
          opportunityId: input.opportunity_id,
          newTotal: total,
          itemCount: items?.length || 0,
          updated,
        },
        clientEvent: { type: 'OPPORTUNITY_UPDATED', data: updated },
      }
    }

    case 'generate_quote': {
      const zone = SHIP2SHORE_PRICING.zones[input.zone]
      if (!zone) throw new Error(`Zone "${input.zone}" not found`)

      const service = SHIP2SHORE_PRICING.services[input.service_type]
      if (!service) throw new Error(`Service type "${input.service_type}" not found`)

      let basePrice = 0
      let lineItems = []

      // Calculate base price based on service type
      if (input.service_type === 'twic_escort') {
        const rate = input.is_military ? service.military : service.standard
        basePrice = rate * (input.quantity || 1)
        lineItems.push({
          item: `${service.name} (${input.quantity} vehicle${input.quantity > 1 ? 's' : ''})`,
          rate: `$${rate}/vehicle`,
          quantity: input.quantity,
          subtotal: basePrice,
        })
      } else if (input.service_type === 'hotshot') {
        basePrice = service.flat
        lineItems.push({
          item: service.name,
          rate: 'flat',
          subtotal: basePrice,
        })
      } else if (input.service_type === 'semi_container') {
        basePrice = service.flat * (input.quantity || 1)
        lineItems.push({
          item: `${service.name} (${input.quantity} unit${input.quantity > 1 ? 's' : ''})`,
          rate: `$${service.flat}/unit`,
          quantity: input.quantity,
          subtotal: basePrice,
        })
      }

      // Calculate surcharges
      let surchargeTotal = 0
      if (input.surcharges && input.surcharges.length > 0) {
        for (const surcharge of input.surcharges) {
          const surchargeInfo = SHIP2SHORE_PRICING.surcharges[surcharge]
          if (surchargeInfo) {
            const surchargeAmount = typeof surchargeInfo === 'object' && surchargeInfo.min
              ? surchargeInfo.min
              : surchargeInfo
            surchargeTotal += surchargeAmount
            lineItems.push({
              item: `Surcharge: ${surcharge}`,
              subtotal: surchargeAmount,
            })
          }
        }
      }

      const total = basePrice + surchargeTotal

      return {
        result: {
          zone: input.zone,
          service: service.name,
          quantity: input.quantity,
          isMilitary: input.is_military,
          lineItems,
          basePrice,
          surcharges: surchargeTotal,
          estimatedTotal: total,
          priceRange: `$${zone.min} - $${zone.max}`,
          notes: input.notes || null,
        },
        clientEvent: null,
      }
    }

    case 'get_pricing_info': {
      return {
        result: SHIP2SHORE_PRICING,
        clientEvent: null,
      }
    }

    case 'edit_deal_value': {
      if (!input.opportunity_id) throw new Error('opportunity_id is required')

      // Get current opportunity to show before/after
      const { data: current, error: fetchErr } = await admin
        .from('opportunities')
        .select('id, title, value, contact_id')
        .eq('id', input.opportunity_id)
        .eq('org_id', orgId)
        .single()

      if (fetchErr) throw new Error(`Opportunity not found: ${fetchErr.message}`)
      if (!current) throw new Error('Opportunity not found or not accessible')

      let newValue
      if (input.new_value !== undefined) {
        // Set exact value
        newValue = input.new_value
      } else if (input.adjust_by_percent !== undefined) {
        // Adjust by percentage
        const adjustment = (current.value || 0) * (input.adjust_by_percent / 100)
        newValue = Math.round((current.value || 0) + adjustment)
      } else {
        throw new Error('Either new_value or adjust_by_percent must be provided')
      }

      // Validate new value
      if (newValue < 0) throw new Error('Deal value cannot be negative')

      // Update the opportunity
      const { data: updated, error: updateErr } = await admin
        .from('opportunities')
        .update({ value: newValue })
        .eq('id', input.opportunity_id)
        .eq('org_id', orgId)
        .select()
        .single()

      if (updateErr) throw new Error(`Failed to update deal: ${updateErr.message}`)

      // Get contact name for better feedback
      let contactName = null
      if (current.contact_id) {
        const { data: contact } = await admin
          .from('contacts')
          .select('full_name')
          .eq('id', current.contact_id)
          .single()
        contactName = contact?.full_name
      }

      const oldValue = current.value || 0
      const difference = newValue - oldValue
      const percentChange = oldValue > 0 ? ((difference / oldValue) * 100).toFixed(1) : 0

      return {
        result: {
          opportunityId: input.opportunity_id,
          contactName,
          dealTitle: current.title,
          oldValue,
          newValue,
          difference,
          percentChange: `${percentChange}%`,
          updated,
        },
        clientEvent: { type: 'OPPORTUNITY_UPDATED', data: updated },
      }
    }

    case 'send_email': {
      let emailBody = ''
      let subject = ''

      if (input.message_type === 'delivery_order_request') {
        subject = 'Ship2Shore - Delivery Order Needed'
        emailBody = `Hi ${input.customer_name},

We're ready to proceed with your booking!

To complete your reservation, please provide:
- Proof of Authorization (POA)
- Delivery order details
- Estimated delivery date/time

${input.booking_details ? `Booking Details:\n${input.booking_details}\n` : ''}

Please reply with the required information so we can finalize your shipment.

Best regards,
Ship2Shore Logistics`
      } else if (input.message_type === 'payment_link_request') {
        subject = 'Ship2Shore - Payment Required'
        emailBody = `Hi ${input.customer_name},

Your vehicle is now cleared and ready to ship!

Booking Amount: $${input.booking_amount}

${input.booking_details ? `Booking Details:\n${input.booking_details}\n` : ''}

Please proceed with payment to secure your shipment. A payment link has been attached.

Thank you,
Ship2Shore Logistics`
      }

      // Log email for now (in production, this would call an email service)
      console.log(`📧 Email to ${input.customer_email}:\nSubject: ${subject}\n${emailBody}`)

      return {
        result: {
          sent: true,
          to: input.customer_email,
          messageType: input.message_type,
          subject,
        },
        clientEvent: null,
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

export const handler = async (event) => {
  try {
    console.log('📍 agent-controller: Handler called')
    const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
    const user = await userFromToken(token)
    if (!user) return json(401, { error: 'Unauthorized' })

    const orgId = await orgForUser(user.id)
    if (!orgId) return json(403, { error: 'No organization' })

    const { userPrompt, conversationHistory = [] } = JSON.parse(event.body || '{}')
    if (!userPrompt) return json(400, { error: 'User prompt required' })

    console.log('📍 agent-controller: User prompt received:', userPrompt.substring(0, 100))
    const messages = [...conversationHistory, { role: 'user', content: userPrompt }]
    const clientEvents = []

    // Agentic loop
    let loopCount = 0
    const MAX_LOOPS = 10
    let finalReply = ''

    while (loopCount < MAX_LOOPS) {
      loopCount++
      console.log(`📍 agent-controller: Loop ${loopCount}`)

      const response = await anthropic.messages.create({
        model: 'claude-opus-5',
        max_tokens: 1024,
        system:
          `You are a helpful CRM assistant for Ship2Shore, a port vehicle escort and logistics company. Help users manage pipeline jobs and generate accurate pricing quotes.

SHIP2SHORE PRICING STRUCTURE:

ZONES & BASE RATES:
- LA Local: $275–325
- Orange County: $300–350
- Ventura County: $325–375
- Valencia/Santa Clarita: $350–400
- Riverside/San Bernardino: $400–475
- San Diego: $600–675
- Northern CA: $625–725

SERVICES:
- TWIC Vehicle Escort: $95/vehicle (standard), $80/vehicle (military/PCS)
- Hotshot Delivery: $200/job flat
- Semi/Container (Tractor-Trailer): $325/unit flat

SURCHARGES (add to base):
- Non-operating: +$200
- Winching: +$125
- Oversized: +$125
- Lifted/Modified: +$125–$175

PORT-SPECIFIC STORAGE/FEES:
- Wilmington (Norton Lilly): Terminal handling $83/vehicle, BL Processing $50, Wharfage $31/vehicle, Service & Facilities $20/unit
- Wilmington (Ports America): Passenger $30/vehicle/day, Commercial/HH $19.65/MT/day, Non-TWIC escort $100
- Long Beach (SSA Marine) & Matson: Rates pending confirmation

WORKFLOW FOR GENERATING QUOTES:
1. Call generate_quote with: zone, service_type, quantity, is_military (if applicable), surcharges
2. Shows line-item breakdown with base price, surcharges, and total
3. Can then add_service_item_to_opportunity to save to a job

EXAMPLES:
- "Quote for 1 car escort in LA" → generate_quote(zone='LA Local', service='twic_escort', quantity=1)
  Result: $95–$325 (zone base applies to base service)

- "Quote 3 car escorts with winching in Orange County" → generate_quote(zone='Orange County', service='twic_escort', quantity=3, surcharges=['winching'])
  Result: $95×3=$285 + $125 winching = $410

- "Hotshot to San Diego plus oversized" → generate_quote(zone='San Diego', service='hotshot', quantity=1, surcharges=['oversized'])
  Result: $200 hotshot + $125 oversized = $325

- "2 semi containers, non-operating situation in Riverside" → generate_quote(zone='Riverside/San Bernardino', service='semi_container', quantity=2, surcharges=['non-operating'])
  Result: $325×2=$650 + $200 non-operating = $850

ALWAYS FOR QUOTES:
1. Ask for zone/location if not provided
2. Clarify if military/PCS (applies $80 instead of $95 for escort)
3. List applicable surcharges
4. Show complete breakdown
5. Offer to add to specific job in pipeline

WHEN YOU SEE "Create a new booking":
1. IMMEDIATELY call create_contact if customer is new (use full_name and email from prompt)
2. THEN call create_opportunity with the contact_id and booking details (use total value as deal_value)
3. IF prompt mentions "Send delivery order request" → call send_email with delivery_order_request
4. IF prompt mentions "Send payment link request" → call send_email with payment_link_request
5. Confirm booking complete with contact name, deal value, and services added

EDITING DEAL VALUES:
Use edit_deal_value to update pipeline deal amounts. Two methods:
1. Set exact value: "Change Sarah's deal to $5,000"
   - edit_deal_value(opportunity_id, new_value=5000)
   - Shows: Old: $3,000 → New: $5,000 (+66.7%)

2. Adjust by percentage: "Increase John's deal by 15%"
   - edit_deal_value(opportunity_id, adjust_by_percent=15)
   - Shows: Old: $4,000 → New: $4,600 (+15%)

3. Can also decrease: "Reduce Sarah's deal by 10%"
   - edit_deal_value(opportunity_id, adjust_by_percent=-10)
   - Shows: Old: $5,000 → New: $4,500 (-10%)

WORKFLOW FOR EDITING:
1. If user mentions a name (e.g., "Sarah's deal"), search for the contact
2. Get their opportunities using get_contact_opportunities
3. Get the opportunity_id
4. Call edit_deal_value with new amount or percentage
5. Confirm: "✓ Updated Sarah's deal: $3,000 → $5,000 (+66.7%)"

The tool shows:
- Contact name
- Deal title
- Old value → New value
- Dollar difference
- Percent change

SENDING CUSTOMER EMAILS:
Use send_email tool to send messages to customers. Two message types:

1. Delivery Order Request (send first):
   - send_email(customer_email="email@example.com", customer_name="John Doe", message_type="delivery_order_request", booking_details="1x TWIC Escort in LA Local - $95")
   - Asks customer for POA and delivery order details
   - SEND THIS FIRST before asking for payment

2. Payment Link Request (send after cleared):
   - send_email(customer_email="email@example.com", customer_name="John Doe", message_type="payment_link_request", booking_amount=95, booking_details="1x TWIC Escort in LA Local")
   - Requests payment once vehicle is cleared
   - ONLY send this after confirmation from user that car is cleared

WORKFLOW FOR BOOKING (CRITICAL - ALWAYS DO THIS):
Step 1: Create contact
   - call create_contact(full_name="customer name from prompt", email="email from prompt")
   - Wait for response with contact.id

Step 2: Create opportunity
   - call create_opportunity(contact_id="use id from step 1", title="Customer Name - Service Type", deal_value=total value, stage="lead")
   - Wait for response with opportunity.id

Step 3: Send emails if requested in prompt
   - If prompt says "Send delivery order request email":
     call send_email(customer_email="from prompt", customer_name="from prompt", message_type="delivery_order_request", booking_details="services and total")
   - If prompt says "Send payment link request email":
     call send_email(customer_email="from prompt", customer_name="from prompt", message_type="payment_link_request", booking_amount=total, booking_details="services")

Step 4: Confirm
   - Reply "✓ Booking created for [name] - Deal: [title] - $[amount] added to pipeline"
   - Include which emails were sent`,
        tools: AGENT_TOOLS,
        messages,
      })

      messages.push({ role: 'assistant', content: response.content })

      console.log(`📍 Stop reason: ${response.stop_reason}`)
      console.log(`📍 Response content: ${JSON.stringify(response.content.map(b => ({ type: b.type, text: b.text?.substring(0, 100), tool_name: b.name })))}`)

      if (response.stop_reason === 'end_turn') {
        finalReply = response.content.find((b) => b.type === 'text')?.text || 'Done'
        console.log(`📍 Agent ended conversation: ${finalReply.substring(0, 100)}`)
        break
      }

      if (response.stop_reason === 'tool_use') {
        console.log(`📍 Agent requesting tools`)
        const toolResults = []

        for (const block of response.content) {
          if (block.type === 'tool_use') {
            console.log(`📍 Tool call: ${block.name}`)
            try {
              const { result, clientEvent } = await executeTool(block.name, block.input, orgId)
              console.log(`📍 Tool ${block.name} succeeded:`, JSON.stringify(result).substring(0, 100))

              if (clientEvent) clientEvents.push(clientEvent)

              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: JSON.stringify(result),
              })
            } catch (toolErr) {
              console.error(`❌ Tool ${block.name} failed:`, toolErr.message)
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                is_error: true,
                content: toolErr.message,
              })
            }
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
