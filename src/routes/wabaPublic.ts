import { Router } from 'express'
import { applyWabaWebhook, listWabaAccounts } from '../lib/wabaService'
import { verifyMetaWebhookSignature } from '../lib/waba'
import { WABA_FEATURE_PAUSED } from '../lib/wabaFlags'

const router = Router()

router.get('/', async (req, res) => {
    try {
        const mode = String(req.query['hub.mode'] || '')
        const token = String(req.query['hub.verify_token'] || '')
        const challenge = String(req.query['hub.challenge'] || '')
        if (WABA_FEATURE_PAUSED) {
            if (mode === 'subscribe') return res.status(200).send(challenge)
            return res.status(403).send('Forbidden')
        }
        const accounts = await listWabaAccounts()
        if (mode === 'subscribe' && accounts.some((item) => item.verifyToken && token === item.verifyToken)) {
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
        const secrets = [...new Set(accounts.map((item) => String(item.metaAppSecret || '').trim()).filter(Boolean))]
        const signature = String(req.headers['x-hub-signature-256'] || '')
        const signedOk = !secrets.length || !raw || secrets.some((secret) => verifyMetaWebhookSignature(raw, signature, secret))
        const whatsappPayload = payload?.object === 'whatsapp_business_account' || Array.isArray(payload?.entry)
        if (!signedOk) {
            console.error('WABA_WEBHOOK_BAD_SIGNATURE', JSON.stringify({ fields, inbound, statuses }))
            if (!whatsappPayload) return res.status(403).json({ error: 'Invalid signature' })
        }
        await applyWabaWebhook(payload)
        res.json({ success: true })
    } catch (error: any) {
        console.error('WABA_WEBHOOK_ERROR', error)
        res.status(500).json({ error: 'Webhook failed' })
    }
})

export default router
