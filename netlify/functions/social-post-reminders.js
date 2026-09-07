import { admin } from './_shared/supabaseAdmin.js'
import { sendTelegramMessage, getOrgTelegramConfig } from './_shared/telegramSend.js'

const PLATFORM_LABEL = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok' }

// Since manual posting (open the app, paste the caption) is still the norm
// for most platforms, a scheduled draft used to just sit there silently --
// nothing told Shawn its time had actually come. Every 15 min: any draft
// whose scheduled_date has passed and hasn't been nudged about yet gets one
// Telegram reminder (reusing the same bot/group every other alert in this
// CRM already uses), then reminded_at is set so it never repeats.
export const handler = async () => {
  const { data: due, error } = await admin
    .from('social_posts')
    .select('id, org_id, platform, text, scheduled_date')
    .eq('status', 'draft')
    .is('reminded_at', null)
    .lte('scheduled_date', new Date().toISOString())

  if (error) {
    console.error('❌ social-post-reminders: could not list due posts:', error)
    return { statusCode: 500, body: error.message }
  }
  if (!due?.length) return { statusCode: 200, body: JSON.stringify({ reminded: 0 }) }

  let reminded = 0
  for (const post of due) {
    const { groupChatId } = await getOrgTelegramConfig(post.org_id)
    if (!groupChatId) continue // this org hasn't set up Telegram -- nothing to send, move on

    const platform = PLATFORM_LABEL[post.platform] || 'social media'
    const preview = (post.text || '').slice(0, 120)
    await sendTelegramMessage({
      orgId: post.org_id,
      chatId: groupChatId,
      text: `⏰ Time to post on ${platform}!\n\n"${preview}${post.text?.length > 120 ? '…' : ''}"\n\nOpen Social Posts in the CRM to grab the photo and caption.`,
      context: `Scheduled ${platform} post reminder`,
    })
    await admin.from('social_posts').update({ reminded_at: new Date().toISOString() }).eq('id', post.id)
    reminded++
  }

  return { statusCode: 200, body: JSON.stringify({ reminded }) }
}
