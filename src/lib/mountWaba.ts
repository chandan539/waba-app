import express from 'express'
import { setWabaAdapters, wabaAutoUpdateEnabled, type WabaAdapters } from './adapters'
import { checkWabaAutoUpdate } from './wabaAutoUpdates'
import { processAssistantJobs } from './assistantWorker'
import { processWhatsAppQueue } from './wabaService'
import wabaAdminRouter from '../routes/waba'
import wabaWebhookRouter from '../routes/wabaPublic'

type MountOptions = WabaAdapters & {
    requireAdmin: NonNullable<WabaAdapters['requireAdmin']>
    adminPath?: string
    webhookPath?: string
    workers?: boolean
}

function startWorker(interval: number, label: string, work: () => Promise<unknown>) {
    let running = false
    const timer = setInterval(async () => {
        if (running) return
        running = true
        try { await work() }
        catch (error) { console.error(label, error) }
        finally { running = false }
    }, interval)
    timer.unref()
    return () => clearInterval(timer)
}

/** Mount one Wabix installation per Express process, before general body parsers. */
export function mountWaba(app: express.Express, {
    adminPath = '/api/admin/waba',
    webhookPath = '/api/whatsapp/webhook',
    workers = true,
    ...adapters
}: MountOptions) {
    const literalPath = /^\/[\w.-]+(?:\/[\w.-]+)*$/
    if (!literalPath.test(adminPath) || !literalPath.test(webhookPath)
        || adminPath === webhookPath || adminPath.startsWith(webhookPath + '/') || webhookPath.startsWith(adminPath + '/')) {
        throw new Error('Wabix admin and webhook paths must be distinct, non-overlapping URL paths.')
    }
    setWabaAdapters(adapters)
    app.use(adminPath, express.json({ limit: '15mb' }), wabaAdminRouter)
    app.use(webhookPath, express.json({
        limit: '15mb',
        verify: (request, _response, bytes) => { Object.assign(request, { rawBody: bytes }) },
    }), wabaWebhookRouter)
    if (!workers) return () => {}

    const stopAssistant = startWorker(2000, 'WABA_ASSISTANT', processAssistantJobs)
    const stopQueue = startWorker(60_000, 'WABA_QUEUE', processWhatsAppQueue)
    const stopUpdates = wabaAutoUpdateEnabled() ? startWorker(30 * 60_000, 'WABA_UPDATE', checkWabaAutoUpdate) : undefined
    if (stopUpdates) void checkWabaAutoUpdate().catch(error => console.error('WABA_UPDATE', error))
    return () => { stopAssistant(); stopQueue(); stopUpdates?.() }
}
