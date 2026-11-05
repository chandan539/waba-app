import { Router } from 'express'
import { listWabaAccounts } from '../lib/wabaService'
import { verifyMetaWebhookSignature } from '../lib/waba'
import { WABA_FEATURE_PAUSED } from '../lib/wabaFlags'
import { storeWebhook } from '../lib/assistantStore'
import { getAssistantAdapters, getWabaPrisma } from '../lib/adapters'
import { confirmBooking } from '../lib/assistantBookings'
import { renderBookingMedia, verifyBookingMedia } from '../lib/assistantMedia'
import { getAssistantSettings } from '../lib/assistantStore'

const router = Router()

router.get('/', async (req, res) => {
    try {
        const mode = String(req.query['hub.mode'] || '')
        const token = String(req.query['hub.verify_token'] || '')
        const challenge = String(req.query['hub.challenge'] || '')
        if (WABA_FEATURE_PAUSED) {
            return res.status(403).send('Forbidden')
        }
        const accounts = await listWabaAccounts()
        if (mode === 'subscribe' && accounts.some((item: any) => item.verifyToken && token === item.verifyToken)) {
            return res.status(200).send(challenge)
        }
        return res.status(403).send('Forbidden')
    } catch (error) {
        return res.status(500).send('Error')
    }
})

router.post('/', async (req, res) => {
    try {
        if (WABA_FEATURE_PAUSED) {
            return res.json({ success: true, paused: true })
        }
        const accounts = await listWabaAccounts()
        const raw = (req as any).rawBody as Buffer | undefined
        const payload = req.body || {}
        const changes = Array.isArray(payload.entry)
            ? payload.entry.flatMap((entry: any) => Array.isArray(entry?.changes) ? entry.changes : [])
            : []
        const fields = changes.map((change: any) => String(change?.field || '')).filter(Boolean)
        const inbound = changes.reduce((sum: number, change: any) => {
            const value = change?.value || {}
            return sum
                + (Array.isArray(value.messages) ? value.messages.length : 0)
                + (Array.isArray(value.message_echoes) ? value.message_echoes.length : 0)
        }, 0)
        const statuses = changes.reduce((sum: number, change: any) => {
            const value = change?.value || {}
            return sum + (Array.isArray(value.statuses) ? value.statuses.length : 0)
        }, 0)
        console.log('WABA_WEBHOOK', JSON.stringify({ fields, inbound, statuses, hasRaw: Boolean(raw), hasSig: Boolean(req.headers['x-hub-signature-256']) }))
        const signature = String(req.headers['x-hub-signature-256'] || '')
        if (!raw || !signature || payload.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry) || !payload.entry.length) {
            return res.status(403).json({ error: 'Signed WhatsApp payload and raw body required' })
        }
        const authorized = payload.entry.every((entry: any) => {
            const candidates = accounts.filter((account: any) => account.wabaId === String(entry.id || ''))
            const phoneIds = (entry.changes || []).map((change: any) => change.value?.metadata?.phone_number_id).filter(Boolean).map(String)
            return candidates.some((account: any) => account.metaAppSecret && verifyMetaWebhookSignature(raw, signature, account.metaAppSecret!))
                && phoneIds.every((id: string) => candidates.some((account: any) => account.phoneNumberId === id))
        })
        if (!authorized) return res.status(403).json({ error: 'Invalid signature or unknown WhatsApp account' })
        await storeWebhook(payload, raw)
        res.json({ success: true })
    } catch (error: any) {
        console.error('WABA_WEBHOOK_ERROR', error)
        res.status(500).json({ error: 'Webhook failed' })
    }
})

router.get('/media/:kind/:id', async (req, res) => {
    const { kind, id } = req.params
    if (!verifyBookingMedia(String(id), String(kind), String(req.query.expires || ''), String(req.query.signature || ''))) return res.status(403).send('Invalid or expired media link')
    try {
        const booking = await getWabaPrisma().whatsAppBooking.findUnique({ where: { id: String(id) } })
        if (!booking) return res.status(404).send('Not found')
        const settings = await getAssistantSettings(booking.accountId)
        const png = await renderBookingMedia(booking, settings.businessName, settings.timezone, kind as 'ticket' | 'payment')
        res.set('Cache-Control', 'private, no-store').type('png').send(png)
    } catch { res.status(404).send('Media unavailable') }
})

// Provider adapter must verify the signature against these exact bytes and return only captured payments.
router.post('/payments/:provider', async (req, res) => {
    try {
        const verify = getAssistantAdapters().verifyPaymentWebhook
        const raw = (req as any).rawBody as Buffer | undefined
        if (!verify || !raw) return res.status(503).json({ error: 'Verified payment webhook adapter is not configured' })
        const receipt = await verify({ provider: String(req.params.provider), rawBody: raw, headers: req.headers })
        if (!receipt) return res.status(403).json({ error: 'Invalid payment notification' })
        if (!receipt.captured) return res.json({ success: true, ignored: true })
        await confirmBooking(receipt.bookingId, receipt)
        res.json({ success: true })
    } catch (error: any) { res.status(409).json({ error: error.message || 'Payment needs manual review' }) }
})

export default router
