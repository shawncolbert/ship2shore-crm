import { admin, userFromToken, orgForUser } from './_shared/supabaseAdmin.js'
import { orgGoogleMarketingToken, listSearchConsoleSites, listGa4Properties } from './_shared/googleMarketing.js'

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

// Lists what the just-connected Google account can see, so Settings can
// show a picker instead of asking the org to type a site URL or property
// ID by hand -- most people have no idea what either looks like.
export const handler = async (event) => {
  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const user = await userFromToken(token)
  if (!user) return json(401, { error: 'Unauthorized' })
  const orgId = await orgForUser(user.id)
  if (!orgId) return json(403, { error: 'No org membership' })

  try {
    const { accessToken } = await orgGoogleMarketingToken(orgId, admin)
    const [sites, properties] = await Promise.all([
      listSearchConsoleSites(accessToken).catch((e) => ({ error: String(e.message || e) })),
      listGa4Properties(accessToken).catch((e) => ({ error: String(e.message || e) })),
    ])
    return json(200, {
      sites: Array.isArray(sites) ? sites : [],
      sitesError: Array.isArray(sites) ? null : sites.error,
      properties: Array.isArray(properties) ? properties : [],
      propertiesError: Array.isArray(properties) ? null : properties.error,
    })
  } catch (e) {
    return json(400, { error: String(e?.message || e) })
  }
}
