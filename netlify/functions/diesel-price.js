// Retired -- was going to back the interstate quote estimator's fuel
// adjustment with a live EIA diesel price, but the driver-sourced
// $1.50-$2.50/mi range already has fuel baked in, so the extra API
// dependency wasn't worth what little accuracy it would have added. Left as
// a dead endpoint rather than deleted outright so the git history keeps the
// full story of what this was for.
export const handler = async () => ({
  statusCode: 410,
  body: JSON.stringify({ error: 'This fuel-adjustment endpoint has been retired.' }),
})
