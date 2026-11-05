import { Router } from 'express'
import { getAssistantAdapters, getWabaPrisma, wabaRequireAdmin } from '../lib/adapters'
import { getWabaAccount } from '../lib/wabaService'
import { getAssistantSettings, saveAssistantSettings } from '../lib/assistantStore'
import { bookingServices } from '../lib/assistantCore'
import { normalizeWabaPhone } from '../lib/waba'
import { WABA_FEATURE_PAUSED } from '../lib/wabaFlags'
const router = Router()
router.use(wabaRequireAdmin)
router.use((_req, res, next) =>
    WABA_FEATURE_PAUSED ? res.status(503).json({ error: 'WhatsApp is paused' }) : next(),
)
router.use(async (req, res, next) => {
    try {
        const account = await getWabaAccount(String(req.query.accountId || req.body?.accountId || ''))
        if (!account) return res.status(400).json({ error: 'Connect a WhatsApp account first' })
        res.locals.accountId = account.id
        next()
    } catch (error: any) {
        res.status(400).json({ error: error.message })
    }
})
router.get('/', async (_req, res) => {
    try {
        const prisma = getWabaPrisma(),
            accountId = res.locals.accountId
        const [settings, leads, bookings, slots, handovers, jobs, deliveries] = await Promise.all([
            getAssistantSettings(accountId),
            prisma.whatsAppLead.findMany({ where: { accountId }, orderBy: { createdAt: 'desc' }, take: 100 }),
            prisma.whatsAppBooking.findMany({ where: { accountId }, orderBy: { createdAt: 'desc' }, take: 100 }),
            prisma.whatsAppBookingSlot.findMany({
                where: { accountId, startsAt: { gt: new Date() } },
                orderBy: { startsAt: 'asc' },
                take: 100,
            }),
            prisma.whatsAppAssistantSession.findMany({
                where: { accountId, handover: true },
                orderBy: { updatedAt: 'desc' },
                take: 100,
            }),
            prisma.whatsAppAssistantJob.findMany({
                where: { OR: [{ accountId }, { kind: 'WEBHOOK', status: 'FAILED' }] },
                select: {
                    id: true,
                    kind: true,
                    phone: true,
                    status: true,
                    attempts: true,
                    error: true,
                    createdAt: true,
                },
                orderBy: { createdAt: 'desc' },
                take: 40,
            }),
            prisma.whatsAppAssistantDelivery.findMany({
                where: { accountId, status: { not: 'SENT' } },
                select: { key: true, phone: true, status: true, error: true },
                take: 40,
            }),
        ])
        const adapters = getAssistantAdapters()
        res.json({
            settings,
            leads,
            bookings,
            slots,
            handovers,
            jobs,
            deliveries,
            readiness: {
                aiKey: Boolean(process.env.ANTHROPIC_API_KEY),
                payments: Boolean(adapters.createPayment && adapters.verifyPaymentWebhook),
                calendar: Boolean(adapters.validateSlot && adapters.confirmBooking),
                leadSync: Boolean(adapters.onLead),
                media: Boolean(process.env.WABA_MEDIA_SIGNING_SECRET && process.env.WABA_WEBHOOK_URL),
            },
        })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})
router.put('/settings', async (req, res) => {
    try {
        const input = req.body?.settings
        if (input?.enabled && input?.mode === 'LIVE' && input?.aiEnabled && !process.env.ANTHROPIC_API_KEY)
            throw new Error('Add ANTHROPIC_API_KEY to the server before enabling live AI')
        if (
            input?.enabled &&
            input?.mode === 'LIVE' &&
            input?.bookingEnabled &&
            (Number(input.priceMinor) > 0 ||
                input.bookingServices?.some((service: any) => Number(service.priceMinor) > 0))
        ) {
            const adapters = getAssistantAdapters()
            if (!adapters.createPayment || !adapters.verifyPaymentWebhook)
                throw new Error(
                    'Configure payment creation and verified webhooks before enabling paid live bookings',
                )
        }
        res.json({ settings: await saveAssistantSettings(res.locals.accountId, input) })
    } catch (error: any) {
        res.status(400).json({ error: error.message })
    }
})
router.post('/handover', async (req, res) => {
    try {
        const phone = normalizeWabaPhone(req.body?.phone),
            accountId = res.locals.accountId
        if (!phone || typeof req.body?.handover !== 'boolean')
            throw new Error('Phone and handover boolean are required')
        await getWabaPrisma().whatsAppAssistantSession.upsert({
            where: { accountId_phone: { accountId, phone } },
            create: { accountId, phone, handover: req.body.handover, state: {} },
            update: { handover: req.body.handover, state: {} },
        })
        res.json({ success: true })
    } catch (error: any) {
        res.status(400).json({ error: error.message })
    }
})
router.post('/slots', async (req, res) => {
    try {
        const startsAt = new Date(req.body?.startsAt),
            endsAt = new Date(req.body?.endsAt),
            accountId = res.locals.accountId
        if (
            !Number.isFinite(+startsAt) ||
            !Number.isFinite(+endsAt) ||
            +startsAt <= Date.now() ||
            +endsAt <= +startsAt ||
            +endsAt - +startsAt > 86400000
        )
            throw new Error('Provide a future start and later end, at most 24 hours apart')
        const serviceId = String(req.body?.serviceId || 'default')
        if (!bookingServices(await getAssistantSettings(accountId)).some((service) => service.id === serviceId))
            throw new Error('Choose a configured booking session')
        const slot = await getWabaPrisma().$transaction(async (tx: any) => {
            // Serialize slot administration per account, including across server processes.
            await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', accountId)
            const overlap = await tx.whatsAppBookingSlot.findFirst({
                where: { accountId, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
            })
            if (overlap) throw new Error('This slot overlaps an existing slot')
            return tx.whatsAppBookingSlot.create({
                data: {
                    accountId,
                    serviceId,
                    startsAt,
                    endsAt,
                    externalId: req.body?.externalId ? String(req.body.externalId).slice(0, 200) : null,
                },
            })
        })
        res.json({ slot })
    } catch (error: any) {
        res.status(400).json({ error: error.message })
    }
})
router.delete('/slots/:id', async (req, res) => {
    try {
        const result = await getWabaPrisma().whatsAppBookingSlot.deleteMany({
            where: { id: String(req.params.id), accountId: res.locals.accountId, bookingId: null },
        })
        if (!result.count) return res.status(409).json({ error: 'Only an unreserved slot can be removed' })
        res.json({ success: true })
    } catch (error: any) {
        res.status(400).json({ error: error.message })
    }
})
router.post('/jobs/:id/retry', async (req, res) => {
    try {
        const prisma = getWabaPrisma()
        const job = await prisma.whatsAppAssistantJob.findFirst({
            where: { id: String(req.params.id), accountId: res.locals.accountId, status: 'FAILED' },
        })
        if (!job) return res.status(404).json({ error: 'Failed job not found for this account' })
        const uncertain = await prisma.whatsAppAssistantDelivery.count({
            where: { accountId: res.locals.accountId, key: { startsWith: job.key }, status: { not: 'SENT' } },
        })
        if (uncertain)
            return res
                .status(409)
                .json({
                    error: 'An earlier delivery has an unknown outcome. Review it in WhatsApp before taking manual action.',
                })
        await prisma.whatsAppAssistantJob.update({
            where: { id: job.id },
            data: { status: 'PENDING', attempts: 0, availableAt: new Date(), error: null },
        })
        res.json({ success: true })
    } catch (error: any) {
        res.status(400).json({ error: error.message })
    }
})
export default router
