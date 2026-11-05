/**
 * Copy this into the host Express API boot file.
 * Keep rawBody on the webhook path — HMAC verify needs the exact bytes Meta sent.
 */

import express from 'express'
import type { WabaUpdateAdapter } from '../lib/wabaUpdates'
import type { AssistantAdapters } from '../lib/assistantTypes'
import { processAssistantJobs } from '../lib/assistantWorker'
import cron from 'node-cron'
import { setWabaAdapters } from '../lib/adapters'
import { processWhatsAppQueue, triggerWhatsAppFlow } from '../lib/wabaService'
import wabaAdminRouter from '../routes/waba'
import wabaWebhookRouter from '../routes/wabaPublic'

export function mountWaba(app: express.Express, input: {
    prisma: any
    assistant?: AssistantAdapters
    updateWaba?: WabaUpdateAdapter
    requireAdmin: (req: any, res: any, next: any) => void
    getAudiencePhones?: (audience: string) => Promise<Array<{ phone: string; userEmail?: string | null }>>
}) {
    setWabaAdapters({
        prisma: input.prisma,
        assistant: input.assistant,
        updateWaba: input.updateWaba,
        requireAdmin: input.requireAdmin,
        getAudiencePhones: input.getAudiencePhones,
    })

    app.use(express.json({
        limit: '15mb',
        verify: (req, _res, buf) => {
            const path = `${(req as express.Request).originalUrl || ''} ${req.url || ''}`
            if (path.includes('whatsapp/webhook')) (req as any).rawBody = buf
        },
    }))

    app.use('/api/admin/waba', wabaAdminRouter)
    app.use('/api/whatsapp/webhook', wabaWebhookRouter)

    // Mount this BEFORE any other express.json() middleware so signature verification retains raw bytes.
    let assistantRunning = false
    const assistantTimer = setInterval(async () => {
        if (assistantRunning) return
        assistantRunning = true
        try { await processAssistantJobs() } catch (error) { console.error('WABA_ASSISTANT', error) }
        finally { assistantRunning = false }
    }, 2000)
    assistantTimer.unref()

    const queueTask = cron.schedule('* * * * *', async () => {
        await processWhatsAppQueue().catch((error) => console.error('WABA_QUEUE', error))
    })
    return () => { clearInterval(assistantTimer); queueTask.stop() }
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
