import { randomUUID, timingSafeEqual } from 'node:crypto'
import { Router, type Request, type Response } from 'express'
import { getWabaPrisma, wabaRequireAdmin } from '../lib/adapters'
import { formDefinition, metaFormJson, type WhatsAppForm } from '../lib/wabaForms'
import { connectFormsHubSpot, hubSpotAuthorize, hubSpotStatus } from '../lib/wabaFormsHubSpot'
import { getWabaAccount, graphFetch, sendWabaSessionText } from '../lib/wabaService'
import { normalizeWabaPhone } from '../lib/waba'

const router = Router()
router.use(wabaRequireAdmin)
const cookie = '__Host-wabix-hubspot-state'
const cookieOptions = { secure: true, httpOnly: true, sameSite: 'lax' as const, path: '/' }

function handle(fn: (req: Request, res: Response) => Promise<unknown>) {
    return async (req: Request, res: Response) => {
        try { await fn(req, res) }
        catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Forms request failed.' }) }
    }
}

function verifyHubSpotOrigin(req: Request) {
    const redirect = process.env.WABA_HUBSPOT_REDIRECT_URI
    if (!redirect || req.headers.origin !== new URL(redirect).origin) throw new Error('Open Forms on the configured HubSpot callback host.')
}

router.post('/hubspot/start', handle(async (req, res) => {
    verifyHubSpotOrigin(req)
    const state = randomUUID()
    const url = hubSpotAuthorize(state)
    res.cookie(cookie, state, { ...cookieOptions, maxAge: 600000 }).json({ url })
}))

router.post('/hubspot/complete', handle(async (req, res) => {
    verifyHubSpotOrigin(req)
    const stored = req.headers.cookie?.split(';').map(item => item.trim()).find(item => item.startsWith(cookie + '='))?.slice(cookie.length + 1)
    const { state, code } = req.body || {}
    if (!stored || typeof state !== 'string' || !/^[a-f0-9-]{36}$/.test(state)
        || stored.length !== state.length || !timingSafeEqual(Buffer.from(stored), Buffer.from(state))
        || typeof code !== 'string' || !code || code.length > 2048) throw new Error('HubSpot authorization expired. Start again from Forms.')
    res.clearCookie(cookie, cookieOptions)
    res.json(await connectFormsHubSpot(code))
}))

async function accountFor(accountId: unknown) {
    if (typeof accountId !== 'string' || !accountId) throw new Error('Select a connected WhatsApp account.')
    const account = await getWabaAccount(accountId)
    if (!account?.accessToken || !account.wabaId || !account.phoneNumberId) throw new Error('Select a connected WhatsApp account.')
    return account
}

router.get('/', handle(async (req, res) => {
    const prisma = getWabaPrisma()
    const accountId = typeof req.query.accountId === 'string' ? req.query.accountId : ''
    const [forms, deliveries, hubspot] = await Promise.all([
        prisma.whatsAppForm.findMany({ where: { accountId }, orderBy: { createdAt: 'desc' }, take: 100 }),
        prisma.whatsAppAssistantJob.findMany({
            where: { accountId, kind: 'FORM_SUBMISSION' }, orderBy: { createdAt: 'desc' }, take: 30,
            select: { id: true, payload: true, status: true, error: true, createdAt: true },
        }),
        hubSpotStatus(),
    ])
    res.json({ forms, hubspot, deliveries: deliveries.map(({ payload, ...item }: any) => ({ ...item, formId: payload.formId })) })
}))

router.post('/', handle(async (req, res) => {
    const account = await accountFor(req.body.accountId)
    const definition = await formDefinition(req.body)
    const form = await getWabaPrisma().whatsAppForm.create({ data: { accountId: account.id, ...definition } })
    res.status(201).json(form)
}))

router.put('/:id', handle(async (req, res) => {
    const account = await accountFor(req.body.accountId)
    const definition = await formDefinition(req.body)
    const updated = await getWabaPrisma().whatsAppForm.updateMany({
        where: { id: req.params.id, accountId: account.id, metaFlowId: null, published: false }, data: definition,
    })
    if (!updated.count) throw new Error('Only local drafts can be edited. Create a new draft to change a form that has reached Meta.')
    res.json({ success: true })
}))

router.post('/:id/publish', handle(async (req, res) => {
    const account = await accountFor(req.body.accountId)
    const prisma = getWabaPrisma()
    const { flowId, published } = await prisma.$transaction(async (tx: any) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${String(req.params.id)}))`
        const form: WhatsAppForm | null = await tx.whatsAppForm.findFirst({ where: { id: req.params.id, accountId: account.id } })
        if (!form) throw new Error('Form not found.')
        if (form.metaFlowId) return { flowId: form.metaFlowId, published: form.published }
        const created = await graphFetch(`/${account.wabaId}/flows`, account.accessToken, {
            method: 'POST', body: JSON.stringify({ name: `${form.name.slice(0, 55)} ${form.id.slice(0, 8)}`, categories: ['LEAD_GENERATION'] }),
        })
        const id = String(created.id || '')
        if (!/^\d+$/.test(id)) throw new Error('Meta did not return a Flow ID.')
        await tx.whatsAppForm.update({ where: { id: form.id }, data: { metaFlowId: id } })
        return { flowId: id, published: false }
    }, { timeout: 20000 })
    if (!published) await prisma.$transaction(async (tx: any) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${String(req.params.id)}))`
        const form: WhatsAppForm = await tx.whatsAppForm.findUniqueOrThrow({ where: { id: req.params.id } })
        if (form.published) return
        const current = await graphFetch(`/${flowId}`, account.accessToken, { query: { fields: 'status' } })
        if (current.status !== 'PUBLISHED') {
            const asset = new FormData()
            asset.append('name', 'flow.json')
            asset.append('asset_type', 'FLOW_JSON')
            asset.append('file', new Blob([JSON.stringify(metaFormJson(form))], { type: 'application/json' }), 'flow.json')
            const upload = await fetch(`https://graph.facebook.com/${process.env.WABA_GRAPH_VERSION || 'v26.0'}/${flowId}/assets`, {
                method: 'POST', body: asset, headers: { Authorization: `Bearer ${account.accessToken}` },
                signal: AbortSignal.timeout(12000), redirect: 'error',
            })
            const data = await upload.json()
            if (!upload.ok || !data.success || data.validation_errors?.length) {
                throw new Error(String(data.validation_errors?.[0]?.message || data.error?.message || 'Meta rejected the form definition.'))
            }
            const result = await graphFetch(`/${flowId}/publish`, account.accessToken, { method: 'POST' })
            if (!result.success) throw new Error('Meta did not confirm publication.')
        }
        await tx.whatsAppForm.update({ where: { id: form.id }, data: { published: true } })
    }, { timeout: 50000 })
    res.json({ success: true, flowId })
}))

router.post('/:id/send', handle(async (req, res) => {
    const account = await accountFor(req.body.accountId)
    const prisma = getWabaPrisma()
    const form: WhatsAppForm | null = await prisma.whatsAppForm.findFirst({ where: { id: req.params.id, accountId: account.id, published: true } })
    const phone = normalizeWabaPhone(req.body.phone)
    if (!form?.metaFlowId || !phone) throw new Error('Choose a published form and enter a valid WhatsApp number.')
    const token = randomUUID()
    await prisma.whatsAppFormInvite.create({
        data: { id: token, formId: form.id, accountId: account.id, phone, expiresAt: new Date(Date.now() + 7 * 86400000) },
    })
    await sendWabaSessionText({ accountId: account.id, phone, text: form.name, flow: { id: form.metaFlowId, token } })
    res.json({ success: true })
}))

export default router
