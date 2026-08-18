// Retired -- was a one-time-use utility to upload the Ship2Shore Transport
// landing page's hero map image to Supabase Storage. No longer needed now
// that the image is uploaded; left as a dead endpoint rather than deleted
// outright so the git history keeps the full story of what this was for.
export const handler = async () => ({
  statusCode: 410,
  body: JSON.stringify({ error: 'This one-time utility has been retired.' }),
})
