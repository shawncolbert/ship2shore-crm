// Current US average on-highway diesel price, for the interstate quote
// estimator's fuel adjustment (Pipeline.jsx). Reads EIA_API_KEY -- a free
// key from eia.gov/opendata, kept server-side same as every other secret
// in this app. Fails closed to the $4.00 baseline (0% adjustment) rather
// than breaking the estimator if the key is missing or EIA is unreachable,
// since a stale/unavailable fuel price should never block a staff member
// from getting a quote out.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}
const json = (statusCode, body) => ({
  statusCode, headers: { 'Content-Type': 'application/json', ...cors }, body: JSON.stringify(body),
})

const BASELINE = 4.00
// EIA v2 series id for U.S. On-Highway Diesel Fuel Prices (weekly, $/gal).
const SERIES_ID = 'EMD_EPD2D_PTE_NUS_DPG'

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors }

  const apiKey = process.env.EIA_API_KEY
  if (!apiKey) return json(200, { price: BASELINE, source: 'baseline-fallback', reason: 'EIA_API_KEY not set' })

  try {
    const url = `https://api.eia.gov/v2/petroleum/pri/gnd/data/?api_key=${apiKey}&frequency=weekly&data[0]=value&facets[series][]=${SERIES_ID}&sort[0][column]=period&sort[0][direction]=desc&length=1`
    const res = await fetch(url)
    if (!res.ok) return json(200, { price: BASELINE, source: 'baseline-fallback', reason: `EIA request failed (${res.status})` })
    const data = await res.json()
    const value = data?.response?.data?.[0]?.value
    const period = data?.response?.data?.[0]?.period
    if (typeof value !== 'number') return json(200, { price: BASELINE, source: 'baseline-fallback', reason: 'Unexpected EIA response shape' })
    return json(200, { price: value, source: 'eia', period })
  } catch (e) {
    return json(200, { price: BASELINE, source: 'baseline-fallback', reason: String(e.message || e) })
  }
}
