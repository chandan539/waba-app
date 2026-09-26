/**
 * Copy this into the host Express API boot file.
 * Keep rawBody on the webhook path — HMAC verify needs the exact bytes Meta sent.
 */

import express from 'express'
import cron from 'node-cron'
import { setWabaAdapters } from '../lib/adapters'
import { processWhatsAppQueue, triggerWhatsAppFlow } from '../lib/wabaService'
import wabaAdminRouter from '../routes/waba'
import wabaWebhookRouter from '../routes/wabaPublic'

export function mountWaba(app: express.Express, input: {
    prisma: any
    requireAdmin: (req: any, res: any, next: any) => void
    getAudiencePhones?: (audience: string) => Promise<Array<{ phone: string; userEmail?: string | null }>>
}) {
    setWabaAdapters({
        prisma: input.prisma,
        requireAdmin: input.requireAdmin,
        getAudiencePhones: input.getAudiencePhones,
    })

    app.use(express.json({
        limit: '15mb',
        verify: (req, _res, buf) => {
            const path = `${req.originalUrl || ''} ${req.url || ''}`
            if (path.includes('whatsapp/webhook')) (req as any).rawBody = buf
        },
    }))

    app.use('/api/admin/waba', wabaAdminRouter)
    app.use('/api/whatsapp/webhook', wabaWebhookRouter)

    cron.schedule('* * * * *', async () => {
        await processWhatsAppQueue().catch((error) => console.error('WABA_QUEUE', error))
    })
}

/** Call this from order / lead / warranty handlers. */
export async function notifyWhatsApp(triggerType: string, context: {
    phone?: string | null
    contactPhone?: string | null
    name?: string
    email?: string
    orderId?: string
    total?: string
    awb?: string
    userId?: string
}) {
    return triggerWhatsAppFlow(triggerType, context)
}
