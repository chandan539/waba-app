import { razorpayAssistantAdapters, googleCalendarAssistantAdapters } from '../lib/assistantProviders'
import type { AssistantAdapters } from '../lib/assistantTypes'

/** Use in mountWaba({ prisma, requireAdmin, assistant: configuredAssistantAdapters() }).
 * Credentials are server-only. These optional providers serve one business workspace.
 */
export function configuredAssistantAdapters(): AssistantAdapters {
    const payments = process.env.RAZORPAY_KEY_ID
        ? razorpayAssistantAdapters({
              keyId: process.env.RAZORPAY_KEY_ID,
              keySecret: process.env.RAZORPAY_KEY_SECRET || '',
              webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
          })
        : {}
    const calendar = process.env.GOOGLE_CALENDAR_ID
        ? googleCalendarAssistantAdapters({
              calendarId: process.env.GOOGLE_CALENDAR_ID,
              clientId: process.env.GOOGLE_CLIENT_ID || '',
              clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
              refreshToken: process.env.GOOGLE_REFRESH_TOKEN || '',
              createMeet: process.env.GOOGLE_CREATE_MEET === 'true',
          })
        : {}
    return {
        ...payments,
        ...calendar,
        // Add onLead(lead, idempotencyKey) to upsert into your CRM.
        // Add onHandover(contact, idempotencyKey) to notify your support team.
    }
}
