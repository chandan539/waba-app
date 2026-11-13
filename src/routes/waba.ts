import formsRouter from './wabaForms'
import { downloadWabaInboxAttachment } from '../lib/wabaInboxDownload'
import { Router } from 'express'
import crypto from 'crypto'
import assistantRouter from './wabaAssistant'
import analyticsRouter from './wabaAnalytics'
import updatesRouter from './wabaUpdates'
import { getWabaPrisma, wabaRequireAdmin as requireAdmin } from '../lib/adapters'
import { WABA_AUDIENCES, WABA_TEMPLATE_CATEGORIES } from '../lib/waba'
import { WABA_FEATURE_PAUSED } from '../lib/wabaFlags'
import {
    connectManual,
    createAndSubmitTemplate,
    deleteWabaAccount,
    disconnectWaba,
    exchangeEmbeddedSignup,
    getWabaAccount,
    getWabaSettings,
    listWabaConversations,
    listWabaThread,
    listWhatsAppFlows,
    markWabaThreadRead,
    selectWabaAccount,
    sendWabaCampaign,
    sendWabaSessionText,
    sendWabaTemplate,
    subscribeAndRefresh,
    syncWabaTemplates,
    maintainWabaConnection,
    ensureEventWabaSetup,
    upsertWabaAccount,
    wabaPublicStatus,
} from '../lib/wabaService'

const prisma = new Proxy({} as any, {
    get(_target, prop) {
        return getWabaPrisma()[prop]
    },
})

const router = Router()
router.use('/updates', updatesRouter)

router.use((_req, res, next) => {
    if (WABA_FEATURE_PAUSED) {
        return res.status(503).json({ error: 'WhatsApp WABA is paused' })
    }
    next()
})

router.use('/forms', formsRouter)
router.use('/assistant', assistantRouter)
router.use('/analytics', analyticsRouter)

router.get('/', requireAdmin, async (req, res) => {
    try {
        const accountId = String(req.query.accountId || '')
        await maintainWabaConnection(false).catch(() => null)
        const status = await wabaPublicStatus(accountId || null)
        const selectedId = status.id || accountId || undefined
        const [templates, campaigns, queue] = await Promise.all([
            prisma.whatsAppTemplate.findMany({ where: selectedId ? { accountId: selectedId } : undefined, orderBy: { updatedAt: 'desc' } }).catch(() => []),
            prisma.whatsAppCampaign.findMany({ where: selectedId ? { accountId: selectedId } : undefined, include: { template: true }, orderBy: { createdAt: 'desc' }, take: 50 }).catch(() => []),
            prisma.whatsAppQueue.findMany({ where: selectedId ? { accountId: selectedId } : undefined, orderBy: { createdAt: 'desc' }, take: 40 }).catch(() => []),
        ])
        res.json({ status, templates, campaigns, queue })
    } catch (error: any) {
        res.status(500).json({ error: error.message || 'Failed to load WABA' })
    }
})

router.post('/settings', requireAdmin, async (req, res) => {
    try {
        const saved = await getWabaSettings()
        const metaAppSecret = String(req.body?.metaAppSecret || '').trim()
        const verifyToken = String(req.body?.verifyToken || saved?.verifyToken || crypto.randomBytes(12).toString('hex'))
        const data: Record<string, unknown> = {
            metaAppId: String(req.body?.metaAppId || '').trim() || saved?.metaAppId || null,
            embeddedSignupConfigId: String(req.body?.embeddedSignupConfigId || '').trim() || saved?.embeddedSignupConfigId || null,
            verifyToken,
            ...(metaAppSecret ? { metaAppSecret } : {}),
        }
        const updated = await prisma.whatsAppAccount.updateMany({ data })
        if (!updated.count) await upsertWabaAccount(data)
        res.json({ success: true, ...(await wabaPublicStatus()) })
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Could not save Meta settings' })
    }
})

router.post('/accounts/select', requireAdmin, async (req, res) => {
    try {
        await selectWabaAccount(String(req.body?.accountId || ''))
        res.json({ success: true, ...(await wabaPublicStatus()) })
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Could not switch WhatsApp number' })
    }
})

router.delete('/accounts/:id', requireAdmin, async (req, res) => {
    try {
        const status = await deleteWabaAccount(req.params.id)
        res.json({ success: true, ...status })
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Could not delete WhatsApp number' })
    }
})

router.post('/embedded-signup', requireAdmin, async (req, res) => {
    try {
        const status = await exchangeEmbeddedSignup({
            code: String(req.body?.code || ''),
            wabaId: req.body?.wabaId,
            phoneNumberId: req.body?.phoneNumberId,
            businessId: req.body?.businessId,
            pin: req.body?.pin,
            redirectUri: req.body?.redirectUri,
            sdk: Boolean(req.body?.sdk),
        })
        res.json({ success: true, ...status })
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Embedded Signup failed' })
    }
})

router.post('/manual', requireAdmin, async (req, res) => {
    try {
        const status = await connectManual({
            accessToken: String(req.body?.accessToken || ''),
            wabaId: String(req.body?.wabaId || ''),
            phoneNumberId: String(req.body?.phoneNumberId || ''),
            pin: req.body?.pin,
        })
        res.json({ success: true, ...status })
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Could not connect WABA' })
    }
})

router.post('/refresh', requireAdmin, async (req, res) => {
    try {
        res.json({ success: true, ...(await subscribeAndRefresh({ pin: req.body?.pin, accountId: req.body?.accountId })) })
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Could not refresh WABA' })
    }
})

router.post('/disconnect', requireAdmin, async (req, res) => {
    try {
        res.json({ success: true, ...(await disconnectWaba(req.body?.accountId)) })
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Could not disconnect' })
    }
})

router.post('/templates', requireAdmin, async (req, res) => {
    try {
        const category = String(req.body?.category || 'UTILITY').toUpperCase()
        if (!WABA_TEMPLATE_CATEGORIES.includes(category as any)) {
            return res.status(400).json({ error: 'Category must be UTILITY, MARKETING or AUTHENTICATION' })
        }
        const template = await createAndSubmitTemplate({
            name: String(req.body?.name || ''),
            language: req.body?.language,
            category,
            body: String(req.body?.body || ''),
        })
        res.json({ success: true, template })
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Could not submit template' })
    }
})

router.post('/templates/events', requireAdmin, async (_req, res) => {
    try {
        const templates = await ensureEventWabaSetup()
        res.json({ success: true, templates })
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Could not submit event templates' })
    }
})

router.post('/templates/sync', requireAdmin, async (_req, res) => {
    try {
        const templates = await syncWabaTemplates()
        res.json({ success: true, templates })
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Could not sync templates' })
    }
})

router.delete('/templates/:id', requireAdmin, async (req, res) => {
    try {
        await prisma.whatsAppTemplate.delete({ where: { id: req.params.id } })
        res.json({ success: true })
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Could not delete template' })
    }
})

router.post('/campaigns', requireAdmin, async (req, res) => {
    try {
        const audience = String(req.body?.audience || 'ORDERS').toUpperCase()
        if (!WABA_AUDIENCES.includes(audience as any)) {
            return res.status(400).json({ error: 'Audience must be ORDERS, LEADS or BOTH' })
        }
        const selected = await getWabaAccount()
        const campaign = await prisma.whatsAppCampaign.create({
            data: {
                accountId: selected?.id || null,
                name: String(req.body?.name || '').trim() || 'Untitled campaign',
                templateId: String(req.body?.templateId || ''),
                audience,
            },
            include: { template: true },
        })
        res.json({ success: true, campaign })
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Could not create campaign' })
    }
})

router.post('/campaigns/:id/send', requireAdmin, async (req, res) => {
    try {
        const campaign = await sendWabaCampaign(req.params.id)
        res.json({ success: true, campaign })
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Could not send campaign' })
    }
})

router.post('/test', requireAdmin, async (req, res) => {
    try {
        const template = await prisma.whatsAppTemplate.findUnique({ where: { id: String(req.body?.templateId || '') } })
        if (!template) return res.status(404).json({ error: 'Template not found' })
        const sent = await sendWabaTemplate({
            phone: String(req.body?.phone || ''),
            templateName: template.name,
            language: template.language,
            params: Array.isArray(req.body?.params) ? req.body.params.map(String) : [],
            accountId: template.accountId,
        })
        res.json({ success: true, ...sent })
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Test send failed' })
    }
})

router.get('/inbox', requireAdmin, async (req, res) => {
    try {
        const all = req.query.scope === 'all'
        const accountId = String(req.query.accountId || '')
        const page = Number(req.query.page || 1)
        if (!Number.isSafeInteger(page) || page < 1) return res.status(400).json({ error: 'Choose a valid page.' })
        const [{ conversations, hasNext }, templates] = await Promise.all([
            listWabaConversations(accountId, all, {
                page,
                search: typeof req.query.search === 'string' ? req.query.search : '',
                unreadOnly: req.query.unread === 'true',
            }),
            accountId ? prisma.whatsAppTemplate.findMany({
                where: { accountId, status: 'APPROVED' }, select: { id: true, name: true, status: true },
            }) : undefined,
        ])
        res.json({ success: true, conversations, templates, page, hasNext, unread: conversations.reduce((sum: number, item: any) => sum + (item.unreadCount || 0), 0) })
    } catch (error: any) {
        res.status(500).json({ error: error.message || 'Could not load inbox' })
    }
})

router.get('/inbox/attachments/:messageId', requireAdmin, downloadWabaInboxAttachment)

router.get('/inbox/:phone', requireAdmin, async (req, res) => {
    try {
        const thread = await listWabaThread(String(req.params.phone || ''), String(req.query.accountId || ''), typeof req.query.before === 'string' ? req.query.before : undefined, req.query.archive === 'true')
        res.json({ success: true, ...thread })
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Could not load conversation' })
    }
})

router.post('/inbox/read', requireAdmin, async (req, res) => {
    try {
        await markWabaThreadRead(String(req.body?.phone || ''), req.body?.accountId)
        res.json({ success: true })
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Could not mark read' })
    }
})

router.post('/inbox/reply', requireAdmin, async (req, res) => {
    try {
        const sent = await sendWabaSessionText({
            phone: String(req.body?.phone || ''),
            text: String(req.body?.text || ''),
            accountId: req.body?.accountId,
        })
        res.json({ success: true, ...sent })
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Could not send reply' })
    }
})

router.post('/inbox/template', requireAdmin, async (req, res) => {
    try {
        const template = await prisma.whatsAppTemplate.findUnique({ where: { id: String(req.body?.templateId || '') } })
        if (!template) return res.status(404).json({ error: 'Template not found' })
        if (req.body?.accountId && template.accountId !== req.body.accountId) {
            return res.status(400).json({ error: 'Choose a template for the receiving business number.' })
        }
        if (String(template.status).toUpperCase() !== 'APPROVED') {
            return res.status(400).json({ error: 'Only APPROVED templates can be sent' })
        }
        const sent = await sendWabaTemplate({
            phone: String(req.body?.phone || ''),
            templateName: template.name,
            language: template.language,
            params: Array.isArray(req.body?.params) ? req.body.params.map(String) : [],
            accountId: req.body?.accountId || template.accountId,
        })
        res.json({ success: true, ...sent })
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Could not send template' })
    }
})

router.get('/flows', requireAdmin, async (req, res) => {
    try {
        const flows = await listWhatsAppFlows(String(req.query.accountId || ''))
        res.json({ success: true, flows })
    } catch (error: any) {
        res.status(500).json({ error: error.message || 'Could not load WhatsApp flows' })
    }
})

router.post('/flows', requireAdmin, async (req, res) => {
    try {
        const selected = await getWabaAccount(req.body?.accountId)
        const flow = await prisma.whatsAppFlow.create({
            data: {
                accountId: selected?.id || null,
                name: String(req.body?.name || '').trim() || 'Untitled WhatsApp flow',
                triggerType: String(req.body?.triggerType || 'ORDER_PLACED'),
                isActive: !!req.body?.isActive,
            },
            include: { steps: true },
        })
        res.json({ success: true, flow })
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Could not create flow' })
    }
})

router.put('/flows/:id', requireAdmin, async (req, res) => {
    try {
        const flow = await prisma.whatsAppFlow.update({
            where: { id: req.params.id },
            data: {
                name: String(req.body?.name || '').trim() || 'Untitled WhatsApp flow',
                triggerType: String(req.body?.triggerType || 'ORDER_PLACED'),
                isActive: !!req.body?.isActive,
            },
            include: { steps: { orderBy: { sequenceOrder: 'asc' } } },
        })
        res.json({ success: true, flow })
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Could not update flow' })
    }
})

router.delete('/flows/:id', requireAdmin, async (req, res) => {
    try {
        await prisma.whatsAppFlow.delete({ where: { id: req.params.id } })
        res.json({ success: true })
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Could not delete flow' })
    }
})

router.post('/flows/:id/steps', requireAdmin, async (req, res) => {
    try {
        const templateName = String(req.body?.templateName || '').trim()
        if (!templateName) return res.status(400).json({ error: 'Pick an approved WhatsApp template' })
        const step = await prisma.whatsAppFlowStep.create({
            data: {
                flowId: req.params.id,
                sequenceOrder: Number(req.body?.sequenceOrder || 1),
                delayHours: Number(req.body?.delayHours || 0),
                templateName,
            },
        })
        res.json({ success: true, step })
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Could not add step' })
    }
})

router.put('/flow-steps/:id', requireAdmin, async (req, res) => {
    try {
        const templateName = String(req.body?.templateName || '').trim()
        if (!templateName) return res.status(400).json({ error: 'Pick an approved WhatsApp template' })
        const step = await prisma.whatsAppFlowStep.update({
            where: { id: req.params.id },
            data: {
                sequenceOrder: Number(req.body?.sequenceOrder || 1),
                delayHours: Number(req.body?.delayHours || 0),
                templateName,
            },
        })
        res.json({ success: true, step })
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Could not update step' })
    }
})

router.delete('/flow-steps/:id', requireAdmin, async (req, res) => {
    try {
        await prisma.whatsAppFlowStep.delete({ where: { id: req.params.id } })
        res.json({ success: true })
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Could not delete step' })
    }
})

export default router
