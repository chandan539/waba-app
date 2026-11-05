import { getWabaPrisma, hostAudiencePhones } from './adapters'
import { resolveWabaWebhookUrl } from './config'
import {
    EVENT_WABA_TEMPLATES,
    WABA_TEMPLATE_CATEGORIES,
    buildTemplateComponents,
    graphUrl,
    isStopKeyword,
    isWabaCustomerCareOpen,
    normalizeWabaPhone,
    parseWabaWebhookMessages,
    publicWabaAccount,
    publicWabaStatus,
    templateParamsFromContext,
    toMetaTemplateBody,
    toMetaTemplateName,
    normalizeWabaPin,
    isWabaCloudRegistered,
} from './waba'
import { WABA_FEATURE_PAUSED } from './wabaFlags'
import { isAllowedWabaOauthRedirectUri, wabaOauthRedirectUri } from './wabaSignup'

const prisma = new Proxy({} as any, {
    get(_target, prop) {
        return getWabaPrisma()[prop]
    },
})

function jsonField(value: unknown) {
    return JSON.parse(JSON.stringify(value ?? null))
}

export async function getWabaAccount(accountId?: string | null) {
    if (accountId) {
        const exact = await prisma.whatsAppAccount.findUnique({ where: { id: String(accountId) } })
        if (exact) return exact
    }
    return (
        await prisma.whatsAppAccount.findFirst({ where: { isSelected: true } })
        || await prisma.whatsAppAccount.findFirst({ orderBy: [{ connectedAt: 'desc' }, { updatedAt: 'desc' }] })
    )
}

export async function listWabaAccounts() {
    return prisma.whatsAppAccount.findMany({ orderBy: [{ isSelected: 'desc' }, { connectedAt: 'desc' }, { updatedAt: 'desc' }] })
}

export async function getWabaSettings() {
    return (
        await prisma.whatsAppAccount.findFirst({
            where: { OR: [{ metaAppSecret: { not: null } }, { metaAppId: { not: null } }] },
            orderBy: { updatedAt: 'desc' },
        })
        || await getWabaAccount()
    )
}

function settingsPayload(source?: Record<string, any> | null) {
    return {
        metaAppId: source?.metaAppId || null,
        metaAppSecret: source?.metaAppSecret || null,
        embeddedSignupConfigId: source?.embeddedSignupConfigId || null,
        verifyToken: source?.verifyToken || null,
    }
}

export async function selectWabaAccount(accountId: string) {
    const account = await prisma.whatsAppAccount.findUnique({ where: { id: String(accountId || '') } })
    if (!account) throw new Error('WhatsApp number not found')
    await prisma.whatsAppAccount.updateMany({ data: { isSelected: false } })
    return prisma.whatsAppAccount.update({ where: { id: account.id }, data: { isSelected: true } })
}

export async function upsertWabaAccount(data: Record<string, unknown>, accountId?: string | null) {
    const current = await getWabaAccount(accountId)
    if (current) {
        return prisma.whatsAppAccount.update({ where: { id: current.id }, data })
    }
    await prisma.whatsAppAccount.updateMany({ data: { isSelected: false } })
    return prisma.whatsAppAccount.create({ data: { ...data, isSelected: true } })
}

export function wabaWebhookUrl() {
    return resolveWabaWebhookUrl()
}

export async function wabaPublicStatus(accountId?: string | null) {
    const [selected, accounts] = await Promise.all([getWabaAccount(accountId), listWabaAccounts()])
    const settings = accounts.find((item) => item.metaAppId || item.metaAppSecret || item.verifyToken) || selected
    let phoneMeta: Record<string, string> = {}
    let health: { nameStatus?: string; accountMode?: string; canSendMessage?: string; healthError?: string; reviewStatus?: string } = {}
    if (selected?.accessToken && selected.phoneNumberId) {
        const phone = await graphFetch(`/${selected.phoneNumberId}`, selected.accessToken, {
            query: { fields: 'display_phone_number,verified_name,quality_rating,code_verification_status,status,platform_type,name_status,account_mode,messaging_limit_tier' },
        }).catch(() => null)
        if (phone) {
            phoneMeta = {
                displayName: phone.verified_name || selected.displayName || '',
                displayPhone: phone.display_phone_number || selected.displayPhone || '',
                qualityRating: phone.quality_rating || selected.qualityRating || '',
                phoneStatus: String(phone.status || ''),
                platformType: String(phone.platform_type || ''),
                codeVerificationStatus: String(phone.code_verification_status || ''),
            }
            health.nameStatus = String(phone.name_status || '')
            health.accountMode = String(phone.account_mode || '')
        }
    }
    if (selected?.accessToken && selected.wabaId) {
        const waba = await graphFetch(`/${selected.wabaId}`, selected.accessToken, {
            query: { fields: 'account_review_status,health_status' },
        }).catch(() => null)
        if (waba) {
            health.reviewStatus = String(waba.account_review_status || '')
            health.canSendMessage = String(waba.health_status?.can_send_message || '')
            const blocked = Array.isArray(waba.health_status?.entities)
                ? waba.health_status.entities.flatMap((entity: any) => Array.isArray(entity.errors) ? entity.errors : [])
                : []
            health.healthError = String(blocked[0]?.error_description || blocked[0]?.possible_solution || '')
        }
    }
    return {
        ...publicWabaStatus({
            ...selected,
            metaAppId: selected?.metaAppId || settings?.metaAppId,
            metaAppSecret: selected?.metaAppSecret || settings?.metaAppSecret,
            embeddedSignupConfigId: selected?.embeddedSignupConfigId || settings?.embeddedSignupConfigId,
            verifyToken: selected?.verifyToken || settings?.verifyToken,
            ...phoneMeta,
        }, wabaWebhookUrl()),
        ...health,
        accounts: accounts
            .map((item) => publicWabaAccount(item))
            .filter((item) => item.connected || item.pendingPhone || item.wabaId || item.phoneNumberId),
    }
}

async function graphFetch(path: string, token: string, init?: RequestInit & { query?: Record<string, string> }) {
    const url = graphUrl(path, init?.query)
    const response = await fetch(url, {
        ...init,
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...(init?.headers || {}),
        },
    })
    const text = await response.text()
    let json: any = {}
    try { json = text ? JSON.parse(text) : {} } catch { json = { raw: text } }
    if (!response.ok) {
        const code = json?.error?.code ? `(#${json.error.code}) ` : ''
        const message = json?.error?.error_user_msg || json?.error?.message || text || `Graph HTTP ${response.status}`
        throw new Error(`${code}${message}`)
    }
    return json
}

async function requireConnectedAccount(accountId?: string | null) {
    const account = await getWabaAccount(accountId)
    if (!account?.accessToken || !account.wabaId || !account.phoneNumberId) {
        throw new Error('WhatsApp Business API is not connected')
    }
    return account
}

async function resolveSignupAssets(input: {
    accessToken: string
    appId: string
    secret: string
    wabaId?: string | null
    phoneNumberId?: string | null
    businessId?: string | null
}) {
    let wabaId = String(input.wabaId || '').trim()
    let phoneNumberId = String(input.phoneNumberId || '').trim()
    const businessId = String(input.businessId || '').trim()

    if (!wabaId) {
        try {
            const debug = await graphFetch('/debug_token', `${input.appId}|${input.secret}`, {
                query: { input_token: input.accessToken },
            })
            const scopes = Array.isArray(debug?.data?.granular_scopes) ? debug.data.granular_scopes : []
            const wa = scopes.find((item: any) => String(item.scope || '').includes('whatsapp_business'))
            const ids = Array.isArray(wa?.target_ids) ? wa.target_ids : []
            wabaId = String(ids[0] || '')
        } catch {
            // Session payload is preferred; debug_token is only a fallback.
        }
    }

    if (wabaId && !phoneNumberId) {
        try {
            const phones = await graphFetch(`/${wabaId}/phone_numbers`, input.accessToken)
            phoneNumberId = String(phones?.data?.[0]?.id || '')
        } catch {
            // v4 can finish without a phone number.
        }
    }

    return { wabaId, phoneNumberId, businessId }
}

export async function saveConnectedWaba(input: {
    accessToken: string
    wabaId: string
    phoneNumberId?: string | null
    businessId?: string | null
    pin?: string
}) {
    const settings = await getWabaSettings()
    const phoneNumberId = String(input.phoneNumberId || '').trim()
    const wabaId = String(input.wabaId || '').trim()
    const existing = await prisma.whatsAppAccount.findFirst({
        where: phoneNumberId
            ? { OR: [{ phoneNumberId }, { wabaId }] }
            : { wabaId },
    })
    await prisma.whatsAppAccount.updateMany({ data: { isSelected: false } })
    const data = {
        ...settingsPayload(settings),
        accessToken: input.accessToken,
        wabaId,
        phoneNumberId: phoneNumberId || null,
        businessId: input.businessId || null,
        connectedAt: new Date(),
        isSelected: true,
    }
    const account = existing
        ? await prisma.whatsAppAccount.update({ where: { id: existing.id }, data })
        : await prisma.whatsAppAccount.create({ data })
    await subscribeAndRefresh({ pin: input.pin, accountId: account.id })
    return wabaPublicStatus(account.id)
}

export async function exchangeEmbeddedSignup(input: {
    code: string
    wabaId?: string
    phoneNumberId?: string
    businessId?: string
    pin?: string
    redirectUri?: string
}) {
    const settings = await getWabaSettings()
    const appId = settings?.metaAppId
    const secret = settings?.metaAppSecret
    if (!appId || !secret) throw new Error('Save Meta App ID and App Secret first')
    if (!input.code) throw new Error('Missing Embedded Signup code')

    const redirectUri = isAllowedWabaOauthRedirectUri(String(input.redirectUri || ''))
        ? String(input.redirectUri).trim()
        : wabaOauthRedirectUri()

    const tokenRes = await fetch(graphUrl('/oauth/access_token', {
        client_id: appId,
        client_secret: secret,
        redirect_uri: redirectUri,
        code: input.code,
    }))
    const tokenJson = await tokenRes.json()
    if (!tokenRes.ok || !tokenJson.access_token) {
        throw new Error(tokenJson?.error?.message || 'Could not exchange Meta authorization code')
    }

    let accessToken = String(tokenJson.access_token)
    try {
        const longLived = await fetch(graphUrl('/oauth/access_token', {
            grant_type: 'fb_exchange_token',
            client_id: appId,
            client_secret: secret,
            fb_exchange_token: accessToken,
        }))
        const longJson = await longLived.json()
        if (longLived.ok && longJson.access_token) accessToken = String(longJson.access_token)
    } catch {
        // Keep the original token if the long-lived exchange is unavailable.
    }

    const assets = await resolveSignupAssets({
        accessToken,
        appId,
        secret,
        wabaId: input.wabaId,
        phoneNumberId: input.phoneNumberId,
        businessId: input.businessId,
    })
    if (!assets.wabaId) {
        throw new Error('Embedded Signup did not return a WABA. Finish the Meta popup, then try again.')
    }

    return saveConnectedWaba({
        accessToken,
        wabaId: assets.wabaId,
        phoneNumberId: assets.phoneNumberId || null,
        businessId: assets.businessId || null,
        pin: input.pin,
    })
}

export async function connectManual(input: {
    accessToken: string
    wabaId: string
    phoneNumberId: string
    pin?: string
}) {
    const accessToken = String(input.accessToken || '').trim()
    const wabaId = String(input.wabaId || '').trim()
    const phoneNumberId = String(input.phoneNumberId || '').trim()
    if (!accessToken || !wabaId || !phoneNumberId) throw new Error('Access token, WABA ID and phone number ID are required')
    return saveConnectedWaba({ accessToken, wabaId, phoneNumberId, pin: input.pin })
}

async function registerCloudApiPhone(phoneNumberId: string, token: string, pin?: string | null) {
    try {
        return await graphFetch(`/${phoneNumberId}/register`, token, {
            method: 'POST',
            body: JSON.stringify({ messaging_product: 'whatsapp', pin: normalizeWabaPin(pin) }),
        })
    } catch (error: any) {
        const message = String(error?.message || '')
        if (/133012|already (registered|linked)/i.test(message)) return { success: true }
        if (/133005|PIN Mismatch|two-step verification PIN/i.test(message)) {
            throw new Error('Two-step PIN does not match. Enter the 6-digit PIN from WhatsApp Manager, then click Register on Cloud API.')
        }
        throw new Error(message || 'Could not register this number on Cloud API')
    }
}

export async function subscribeAndRefresh(opts?: { pin?: string; accountId?: string | null }) {
    const account = await getWabaAccount(opts?.accountId)
    if (!account?.accessToken || !account.wabaId) {
        throw new Error('WhatsApp Business API is not connected')
    }
    await graphFetch(`/${account.wabaId}/subscribed_apps`, account.accessToken, { method: 'POST' }).catch((error: any) => {
        const message = String(error?.message || '')
        if (!/already|subscribed/i.test(message)) throw error
    })

    let phoneNumberId = account.phoneNumberId || ''
    if (!phoneNumberId) {
        const phones = await graphFetch(`/${account.wabaId}/phone_numbers`, account.accessToken).catch(() => ({ data: [] }))
        phoneNumberId = String(phones?.data?.[0]?.id || '')
        if (phoneNumberId) await upsertWabaAccount({ phoneNumberId }, account.id)
    }

    if (!phoneNumberId) return wabaPublicStatus(account.id)
    await registerCloudApiPhone(phoneNumberId, account.accessToken, opts?.pin)

    const phone = await graphFetch(`/${phoneNumberId}`, account.accessToken, {
        query: { fields: 'display_phone_number,verified_name,quality_rating,code_verification_status,status,platform_type' },
    }).catch(() => ({}))
    await upsertWabaAccount({
        displayName: phone.verified_name || account.displayName,
        displayPhone: phone.display_phone_number || account.displayPhone,
        qualityRating: phone.quality_rating || account.qualityRating,
        phoneNumberId,
    }, account.id)
    if (!isWabaCloudRegistered(phone)) {
        throw new Error('Number is verified, but Cloud API registration is still pending. Click Register on Cloud API and use the two-step PIN.')
    }
    return wabaPublicStatus(account.id)
}

export async function disconnectWaba(accountId?: string | null) {
    const account = await getWabaAccount(accountId)
    if (account?.wabaId && account.accessToken) {
        await graphFetch(`/${account.wabaId}/subscribed_apps`, account.accessToken, { method: 'DELETE' }).catch(() => null)
    }
    if (account) {
        await upsertWabaAccount({
            accessToken: null,
            wabaId: null,
            phoneNumberId: null,
            businessId: null,
            displayName: null,
            displayPhone: null,
            qualityRating: null,
            connectedAt: null,
        }, account.id)
    }
    return wabaPublicStatus(account?.id)
}

export async function deleteWabaAccount(accountId: string) {
    const account = await prisma.whatsAppAccount.findUnique({ where: { id: String(accountId || '') } })
    if (!account) throw new Error('WhatsApp number not found')
    if (account.wabaId && account.accessToken) {
        await graphFetch(`/${account.wabaId}/subscribed_apps`, account.accessToken, { method: 'DELETE' }).catch(() => null)
    }
    const id = account.id
    const settings = settingsPayload(await getWabaSettings())
    await prisma.whatsAppQueue.deleteMany({ where: { accountId: id } }).catch(() => null)
    await prisma.whatsAppCampaign.deleteMany({ where: { accountId: id } }).catch(() => null)
    await prisma.whatsAppTemplate.deleteMany({ where: { accountId: id } }).catch(() => null)
    await prisma.whatsAppMessage.deleteMany({ where: { accountId: id } }).catch(() => null)
    await prisma.whatsAppContact.deleteMany({ where: { accountId: id } }).catch(() => null)
    await prisma.whatsAppFlow.deleteMany({ where: { accountId: id } }).catch(() => null)
    const remaining = await prisma.whatsAppAccount.count()
    if (remaining <= 1) {
        await prisma.whatsAppAccount.update({
            where: { id },
            data: {
                ...settings,
                isSelected: true,
                accessToken: null,
                wabaId: null,
                phoneNumberId: null,
                businessId: null,
                displayName: null,
                displayPhone: null,
                qualityRating: null,
                connectedAt: null,
            },
        })
        return wabaPublicStatus(id)
    }
    await prisma.whatsAppAccount.updateMany({
        where: { id: { not: id } },
        data: settings,
    })
    await prisma.whatsAppAccount.delete({ where: { id } })
    const next = await prisma.whatsAppAccount.findFirst({ orderBy: [{ connectedAt: 'desc' }, { updatedAt: 'desc' }] })
    if (next) await selectWabaAccount(next.id)
    return wabaPublicStatus()
}

export async function createAndSubmitTemplate(input: {
    name: string
    language?: string
    category?: string
    body: string
}) {
    const account = await requireConnectedAccount()
    const name = toMetaTemplateName(input.name)
    const language = String(input.language || 'en_US').trim() || 'en_US'
    const category = WABA_TEMPLATE_CATEGORIES.includes(String(input.category || '').toUpperCase() as any)
        ? String(input.category).toUpperCase()
        : 'UTILITY'
    if (!name) throw new Error('Template name is required')
    const { body, keys } = toMetaTemplateBody(input.body)
    if (!body.trim()) throw new Error('Template body is required')
    const components = buildTemplateComponents(body, keys)
    const created = await graphFetch(`/${account.wabaId}/message_templates`, account.accessToken!, {
        method: 'POST',
        body: JSON.stringify({ name, language, category, components }),
    })
    return prisma.whatsAppTemplate.create({
        data: {
            accountId: account.id,
            metaId: created.id ? String(created.id) : null,
            name,
            language,
            category,
            status: created.status || 'PENDING',
            bodyText: input.body,
            components: jsonField(components),
            variableKeys: jsonField(keys),
        },
    })
}

export async function ensureEventWabaSetup() {
    const account = await requireConnectedAccount()
    await syncWabaTemplates().catch(() => null)
    const results: Array<{ name: string; trigger: string; status: string; error?: string }> = []
    for (const item of EVENT_WABA_TEMPLATES) {
        let template = await prisma.whatsAppTemplate.findFirst({
            where: { name: item.name, accountId: account.id },
            orderBy: { updatedAt: 'desc' },
        })
        if (!template) {
            try {
                template = await createAndSubmitTemplate({
                    name: item.name,
                    language: 'en_US',
                    category: 'UTILITY',
                    body: item.body,
                })
            } catch (error: any) {
                const message = String(error?.message || error)
                if (/already exists|taken|duplicate|#2388024|#100/i.test(message)) {
                    await syncWabaTemplates().catch(() => null)
                    template = await prisma.whatsAppTemplate.findFirst({
                        where: { name: item.name, accountId: account.id },
                        orderBy: { updatedAt: 'desc' },
                    })
                }
                if (!template) {
                    results.push({ name: item.name, trigger: item.trigger, status: 'FAILED', error: message.slice(0, 180) })
                    continue
                }
            }
        }
        let flow = await prisma.whatsAppFlow.findFirst({
            where: { accountId: account.id, triggerType: item.trigger },
            include: { steps: true },
        })
        if (!flow) {
            flow = await prisma.whatsAppFlow.create({
                data: {
                    accountId: account.id,
                    name: item.label,
                    triggerType: item.trigger,
                    isActive: false,
                    steps: { create: [{ sequenceOrder: 1, delayHours: 0, templateName: item.name }] },
                },
                include: { steps: true },
            })
        } else {
            if (!flow.steps.length) {
                await prisma.whatsAppFlowStep.create({
                    data: { flowId: flow.id, sequenceOrder: 1, delayHours: 0, templateName: item.name },
                })
            }
        }
        results.push({ name: item.name, trigger: item.trigger, status: template.status })
    }
    return results
}

export async function syncWabaTemplates() {
    const account = await requireConnectedAccount()
    const remote = await graphFetch(`/${account.wabaId}/message_templates`, account.accessToken!, {
        query: { limit: '100', fields: 'id,name,language,status,category,components,rejected_reason' },
    })
    const rows = Array.isArray(remote.data) ? remote.data : []
    const saved = []
    for (const item of rows) {
        const name = String(item.name || '')
        const language = String(item.language || 'en')
        const bodyComponent = (item.components || []).find((part: any) => String(part.type).toUpperCase() === 'BODY')
        const bodyText = String(bodyComponent?.text || '')
        const data = {
            accountId: account.id,
            metaId: String(item.id || ''),
            name,
            language,
            category: String(item.category || 'UTILITY'),
            status: String(item.status || 'PENDING').toUpperCase(),
            bodyText: bodyText || name,
            components: jsonField(item.components || []),
            rejectionReason: item.rejected_reason ? String(item.rejected_reason) : null,
        }
        const existing = await prisma.whatsAppTemplate.findFirst({
            where: {
                accountId: account.id,
                OR: [
                    ...(data.metaId ? [{ metaId: data.metaId }] : []),
                    { name },
                ],
            },
            orderBy: { updatedAt: 'desc' },
        })
        saved.push(existing
            ? await prisma.whatsAppTemplate.update({ where: { id: existing.id }, data: { ...data, variableKeys: jsonField(variableKeysFromTemplateBody(bodyText)) } })
            : await prisma.whatsAppTemplate.create({ data: { ...data, variableKeys: jsonField(variableKeysFromTemplateBody(bodyText)) } }))
    }
    return saved
}

function variableKeysFromTemplateBody(body: string) {
    const keys: string[] = []
    String(body || '').replace(/\{\{(\w+)\}\}/g, (_, key) => {
        if (!keys.includes(key)) keys.push(key)
        return ''
    })
    return keys
}

async function findApprovedWabaTemplate(name: string, accountId?: string | null) {
    const wanted = String(name || '').trim().toLowerCase()
    if (!wanted) return null
    const rows = await prisma.whatsAppTemplate.findMany({
        where: { status: 'APPROVED' },
        orderBy: { updatedAt: 'desc' },
    })
    const matches = rows.filter((row) => row.name.toLowerCase() === wanted)
    return matches.find((row) => accountId && row.accountId === accountId) || matches[0] || null
}

let lastWabaMaintain = 0

export async function ensureWabaWebhookSubscription() {
    const account = await getWabaAccount()
    if (!account?.accessToken || !account.wabaId || !account.phoneNumberId) return
    const settings = await getWabaSettings()
    const appId = String(account.metaAppId || settings?.metaAppId || '').trim()
    const secret = String(account.metaAppSecret || settings?.metaAppSecret || '').trim()
    const verify = String(account.verifyToken || settings?.verifyToken || '').trim()
    const callback = wabaWebhookUrl()
    const wantedFields = [
        'messages',
        'message_template_status_update',
        'message_template_quality_update',
        'message_template_components_update',
        'template_category_update',
        'account_update',
        'account_review_update',
        'account_alerts',
        'history',
        'smb_message_echoes',
        'smb_app_state_sync',
        'phone_number_name_update',
        'phone_number_quality_update',
        'security',
        'business_capability_update',
    ].join(',')
    if (appId && secret) {
        const current = await fetch(graphUrl(`/${appId}/subscriptions`), {
            headers: { Authorization: `Bearer ${appId}|${secret}` },
        }).then((response) => response.json()).catch(() => ({ data: [] }))
        const wa = Array.isArray(current?.data)
            ? current.data.find((item: any) => item.object === 'whatsapp_business_account')
            : null
        const fields = Array.isArray(wa?.fields) ? wa.fields.map((item: any) => String(item.name || '')) : []
        const wantedList = wantedFields.split(',')
        const already = Boolean(
            wa?.active
            && String(wa.callback_url || '') === callback
            && wantedList.every((field) => fields.includes(field)),
        )
        if (!already && verify) {
            const body = new URLSearchParams({
                object: 'whatsapp_business_account',
                callback_url: callback,
                verify_token: verify,
                fields: wantedFields,
                access_token: `${appId}|${secret}`,
            })
            const response = await fetch(graphUrl(`/${appId}/subscriptions`), { method: 'POST', body })
            if (!response.ok) {
                const text = await response.text()
                console.error('WABA_WEBHOOK_SUBSCRIBE', text.slice(0, 180))
            }
        }
    }
    const apps = await graphFetch(`/${account.wabaId}/subscribed_apps`, account.accessToken).catch(() => ({ data: [] }))
    const subscribed = Array.isArray(apps?.data) && apps.data.some((item: any) => String(item?.whatsapp_business_api_data?.id || '') === appId)
    if (!subscribed) {
        await graphFetch(`/${account.wabaId}/subscribed_apps`, account.accessToken, { method: 'POST' }).catch(() => null)
    }
    const phone = await graphFetch(`/${account.phoneNumberId}`, account.accessToken, {
        query: { fields: 'webhook_configuration' },
    }).catch(() => null)
    const phoneOverride = String(phone?.webhook_configuration?.phone_number || '').trim()
    if (phoneOverride) {
        await graphFetch(`/${account.phoneNumberId}`, account.accessToken, {
            method: 'POST',
            body: JSON.stringify({ webhook_configuration: { override_callback_uri: '' } }),
        }).catch(() => null)
    }
}

export async function maintainWabaConnection(force = false) {
    const now = Date.now()
    if (!force && now - lastWabaMaintain < 10 * 60 * 1000) return
    lastWabaMaintain = now
    await syncWabaTemplates().catch((error: any) => console.error('WABA_SYNC', error?.message || error))
    await ensureWabaWebhookSubscription().catch((error: any) => console.error('WABA_WEBHOOK_SUBSCRIBE', error?.message || error))
}

export async function sendWabaTemplate(input: {
    phone: string
    templateName: string
    language?: string
    params?: string[]
    accountId?: string | null
}) {
    const account = await requireConnectedAccount(input.accountId)
    const phone = normalizeWabaPhone(input.phone)
    if (!phone) throw new Error('A valid mobile number is required')
    const contact = await prisma.whatsAppContact.findUnique({ where: { accountId_phone: { accountId: account.id, phone } } }).catch(() => null)
    if (contact?.optedOut) throw new Error('This number opted out of WhatsApp messages')
    const stored = await prisma.whatsAppTemplate.findFirst({
        where: { name: input.templateName, accountId: account.id },
        orderBy: { updatedAt: 'desc' },
    }).catch(() => null)
    const keys = Array.isArray(stored?.variableKeys) ? stored.variableKeys as string[] : []
    const params = keys.length
        ? templateParamsFromContext(keys, {
            name: input.params?.[0],
            email: input.params?.[1],
            phone,
            ...(input.params || []).reduce((acc, value, index) => ({ ...acc, [String(index + 1)]: value }), {}),
        })
        : (input.params || [])
    const components = params.length
        ? [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text: text || ' ' })) }]
        : []
    const payload = {
        messaging_product: 'whatsapp',
        to: phone,
        type: 'template',
        template: {
            name: input.templateName,
            language: { code: input.language || stored?.language || 'en_US' },
            ...(components.length ? { components } : {}),
        },
    }
    const result = await graphFetch(`/${account.phoneNumberId}/messages`, account.accessToken!, {
        method: 'POST',
        body: JSON.stringify(payload),
    })
    const metaMessageId = result?.messages?.[0]?.id || null
    const preview = params.length
        ? `Template ${input.templateName}: ${params.join(' · ')}`
        : `Template ${input.templateName}`
    await recordWabaMessage({
        accountId: account.id,
        phone,
        direction: 'OUTBOUND',
        type: 'template',
        body: preview,
        templateName: input.templateName,
        metaMessageId,
        status: 'sent',
        raw: result,
    })
    return { phone, metaMessageId, result }
}

export async function recordWabaMessage(input: {
    accountId?: string | null
    phone: string
    direction: 'INBOUND' | 'OUTBOUND'
    type?: string
    body: string
    templateName?: string | null
    metaMessageId?: string | null
    status?: string | null
    contactName?: string | null
    raw?: unknown
    createdAt?: Date
}) {
    const phone = normalizeWabaPhone(input.phone)
    if (!phone) return null
    const account = await getWabaAccount(input.accountId)
    const accountId = account?.id || input.accountId || null
    const body = String(input.body || '').trim() || `[${input.type || 'text'}]`
    const createdAt = input.createdAt || new Date()
    if (input.metaMessageId) {
        const existing = await prisma.whatsAppMessage.findUnique({ where: { metaMessageId: input.metaMessageId } }).catch(() => null)
        if (existing) return existing
    }
    const message = await prisma.whatsAppMessage.create({
        data: {
            accountId,
            phone,
            direction: input.direction,
            type: input.type || 'text',
            body,
            templateName: input.templateName || null,
            metaMessageId: input.metaMessageId || null,
            status: input.status || (input.direction === 'OUTBOUND' ? 'sent' : 'received'),
            contactName: input.contactName || null,
            raw: jsonField(input.raw),
            createdAt,
        },
    })
    const preview = body.slice(0, 180)
    const inbound = input.direction === 'INBOUND'
    await prisma.whatsAppContact.upsert({
        where: { accountId_phone: { accountId: accountId || '', phone } },
        create: {
            accountId,
            phone,
            displayName: input.contactName || null,
            lastMessage: preview,
            lastMessageAt: createdAt,
            unreadCount: inbound ? 1 : 0,
            lastInboundAt: inbound ? createdAt : null,
            optedOut: inbound && isStopKeyword(body),
            optedOutAt: inbound && isStopKeyword(body) ? createdAt : null,
        },
        update: {
            lastMessage: preview,
            lastMessageAt: createdAt,
            ...(input.contactName ? { displayName: input.contactName } : {}),
            ...(inbound ? {
                lastInboundAt: createdAt,
                unreadCount: { increment: 1 },
                ...(isStopKeyword(body) ? { optedOut: true, optedOutAt: createdAt } : {}),
            } : {}),
        },
    })
    return message
}

export async function listWabaConversations(accountId?: string | null) {
    const account = await getWabaAccount(accountId)
    const scopedId = account?.id || accountId || undefined
    const scopedWhere = scopedId ? { OR: [{ accountId: scopedId }, { accountId: null }] } : {}
    const contacts = await prisma.whatsAppContact.findMany({
        where: scopedWhere,
        orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
        take: 80,
    })
    const withMessages = contacts.filter((row) => row.lastMessageAt || row.lastInboundAt || row.lastMessage)
    if (withMessages.length) return withMessages
    const messages = await prisma.whatsAppMessage.findMany({
        where: scopedWhere,
        orderBy: { createdAt: 'desc' },
        take: 200,
    })
    const byPhone = new Map<string, any>()
    for (const message of messages) {
        if (byPhone.has(message.phone)) continue
        byPhone.set(message.phone, {
            id: message.id,
            accountId: message.accountId,
            phone: message.phone,
            displayName: message.contactName,
            lastMessage: message.body,
            lastMessageAt: message.createdAt,
            unreadCount: message.direction === 'INBOUND' ? 1 : 0,
            optedOut: false,
        })
    }
    return [...byPhone.values()]
}

export async function listWabaThread(phone: string, accountId?: string | null) {
    const normalized = normalizeWabaPhone(phone)
    const account = await getWabaAccount(accountId)
    const scopedId = account?.id || accountId || undefined
    if (!normalized) return { contact: null, messages: [], canReply: false }
    const [contact, messages] = await Promise.all([
        prisma.whatsAppContact.findUnique({ where: { accountId_phone: { accountId: scopedId || '', phone: normalized } } }).catch(() => null),
        prisma.whatsAppMessage.findMany({
            where: { phone: normalized, accountId: scopedId },
            orderBy: { createdAt: 'asc' },
            take: 200,
        }),
    ])
    return {
        contact,
        messages,
        canReply: isWabaCustomerCareOpen(contact?.lastInboundAt),
    }
}

export async function markWabaThreadRead(phone: string, accountId?: string | null) {
    const normalized = normalizeWabaPhone(phone)
    const account = await getWabaAccount(accountId)
    if (!normalized || !account?.id) return null
    return prisma.whatsAppContact.update({
        where: { accountId_phone: { accountId: account.id, phone: normalized } },
        data: { unreadCount: 0 },
    }).catch(() => null)
}

export async function sendWabaSessionText(input: { phone: string; text: string; accountId?: string | null }) {
    const account = await requireConnectedAccount(input.accountId)
    const phone = normalizeWabaPhone(input.phone)
    const text = String(input.text || '').trim()
    if (!phone) throw new Error('A valid mobile number is required')
    if (!text) throw new Error('Type a reply first')
    const contact = await prisma.whatsAppContact.findUnique({ where: { accountId_phone: { accountId: account.id, phone } } }).catch(() => null)
    if (contact?.optedOut) throw new Error('This number opted out of WhatsApp messages')
    if (!isWabaCustomerCareOpen(contact?.lastInboundAt)) {
        throw new Error('Free-form replies only work for 24 hours after the customer messages. Send an approved template instead.')
    }
    const result = await graphFetch(`/${account.phoneNumberId}/messages`, account.accessToken!, {
        method: 'POST',
        body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: phone,
            type: 'text',
            text: { body: text, preview_url: false },
        }),
    })
    const metaMessageId = result?.messages?.[0]?.id || null
    await recordWabaMessage({
        accountId: account.id,
        phone,
        direction: 'OUTBOUND',
        type: 'text',
        body: text,
        metaMessageId,
        status: 'sent',
        raw: result,
    })
    return { phone, metaMessageId, result }
}

export async function listWhatsAppFlows(accountId?: string | null) {
    const account = await getWabaAccount(accountId)
    return prisma.whatsAppFlow.findMany({
        where: { accountId: account?.id || accountId || undefined },
        include: { steps: { orderBy: { sequenceOrder: 'asc' } } },
        orderBy: { createdAt: 'desc' },
    })
}

export async function triggerWhatsAppFlow(triggerType: string, context: Record<string, any> = {}) {
    if (WABA_FEATURE_PAUSED) return 0
    const flows = await prisma.whatsAppFlow.findMany({
        where: { triggerType, isActive: true },
        include: { steps: { orderBy: { sequenceOrder: 'asc' } } },
    })
    const phone = normalizeWabaPhone(context.phone || context.contactPhone)
    if (!phone || !flows.length) return 0
    let queued = 0
    for (const flow of flows) {
        for (const step of flow.steps) {
            const template = await findApprovedWabaTemplate(step.templateName, flow.accountId)
            if (!template) {
                console.log('WABA_FLOW_SKIP', step.templateName)
                continue
            }
            const keys = Array.isArray(template.variableKeys) ? template.variableKeys as string[] : []
            const created = await enqueueWabaMessage({
                accountId: flow.accountId || template.accountId,
                phone,
                userId: context.userId,
                userEmail: context.email,
                flowStepId: step.id,
                templateName: template.name,
                language: template.language,
                params: templateParamsFromContext(keys, context),
                delayHours: step.delayHours || 0,
            })
            if (created) queued += 1
        }
    }
    return queued
}

export async function enqueueWabaMessage(input: {
    accountId?: string | null
    phone?: string | null
    userId?: string | null
    userEmail?: string | null
    campaignId?: string | null
    flowStepId?: string | null
    templateName: string
    language?: string
    params?: string[]
    delayHours?: number
}) {
    const phone = normalizeWabaPhone(input.phone)
    if (!phone || !input.templateName) return null
    const account = await getWabaAccount(input.accountId)
    const contact = account?.id
        ? await prisma.whatsAppContact.findUnique({ where: { accountId_phone: { accountId: account.id, phone } } }).catch(() => null)
        : null
    if (contact?.optedOut) return null
    const scheduledFor = new Date()
    scheduledFor.setHours(scheduledFor.getHours() + Number(input.delayHours || 0))
    return prisma.whatsAppQueue.create({
        data: {
            accountId: account?.id || input.accountId || null,
            phone,
            userId: input.userId || null,
            userEmail: input.userEmail || null,
            campaignId: input.campaignId || null,
            flowStepId: input.flowStepId || null,
            templateName: input.templateName,
            language: input.language || 'en',
            params: jsonField(input.params || []),
            status: 'PENDING',
            scheduledFor,
        },
    })
}

export async function processWhatsAppQueue(limit = 50) {
    if (WABA_FEATURE_PAUSED) return 0
    await maintainWabaConnection().catch(() => null)
    const now = new Date()
    const pending = await prisma.whatsAppQueue.findMany({
        where: { status: 'PENDING', scheduledFor: { lte: now } },
        orderBy: { scheduledFor: 'asc' },
        take: limit,
    })
    let processed = 0
    for (const item of pending) {
        try {
            const sent = await sendWabaTemplate({
                accountId: item.accountId,
                phone: item.phone,
                templateName: item.templateName,
                language: item.language,
                params: Array.isArray(item.params) ? item.params as string[] : [],
            })
            await prisma.whatsAppQueue.update({
                where: { id: item.id },
                data: { status: 'SENT', sentAt: new Date(), metaMessageId: sent.metaMessageId, errorLogs: null },
            })
            if (item.campaignId) {
                await prisma.whatsAppCampaign.update({
                    where: { id: item.campaignId },
                    data: { sentCount: { increment: 1 } },
                })
            }
            processed += 1
        } catch (error: any) {
            await prisma.whatsAppQueue.update({
                where: { id: item.id },
                data: { status: 'FAILED', errorLogs: error?.message || 'Send failed' },
            })
            if (item.campaignId) {
                await prisma.whatsAppCampaign.update({
                    where: { id: item.campaignId },
                    data: { failedCount: { increment: 1 } },
                })
            }
        }
    }
    return processed
}

export async function audiencePhones(audience: string) {
    const phones = new Map<string, { phone: string; userEmail?: string | null }>()
    const rows = await hostAudiencePhones(audience)
    for (const row of rows) {
        const phone = normalizeWabaPhone(row.phone)
        if (phone && !phones.has(phone)) phones.set(phone, { phone, userEmail: row.userEmail })
    }
    const optedOut = await prisma.whatsAppContact.findMany({
        where: { optedOut: true, phone: { in: [...phones.keys()] } },
        select: { phone: true },
    })
    for (const row of optedOut) phones.delete(row.phone)
    return [...phones.values()]
}

export async function sendWabaCampaign(id: string) {
    const campaign = await prisma.whatsAppCampaign.findUnique({ where: { id }, include: { template: true } })
    if (!campaign) throw new Error('Campaign not found')
    if (String(campaign.template.status).toUpperCase() !== 'APPROVED') {
        throw new Error('Only APPROVED templates can be sent')
    }
    const recipients = await audiencePhones(campaign.audience)
    const keys = Array.isArray(campaign.template.variableKeys) ? campaign.template.variableKeys as string[] : []
    let queued = 0
    for (const recipient of recipients) {
        const created = await enqueueWabaMessage({
            accountId: campaign.accountId,
            phone: recipient.phone,
            userEmail: recipient.userEmail,
            campaignId: campaign.id,
            templateName: campaign.template.name,
            language: campaign.template.language,
            params: templateParamsFromContext(keys, { name: recipient.userEmail || 'there', email: recipient.userEmail || '' }),
        })
        if (created) queued += 1
    }
    return prisma.whatsAppCampaign.update({
        where: { id: campaign.id },
        data: { status: 'QUEUED', queuedCount: queued, sentAt: new Date() },
    })
}

export async function queueWhatsAppForFlowStep(step: {
    id: string
    delayHours?: number | null
    whatsappEnabled?: boolean | null
    whatsappTemplateName?: string | null
}, context: Record<string, any>) {
    if (WABA_FEATURE_PAUSED) return
    if (!step.whatsappEnabled || !step.whatsappTemplateName) return
    const template = await findApprovedWabaTemplate(step.whatsappTemplateName)
    if (!template) {
        console.log('WABA_EMAIL_STEP_SKIP', step.whatsappTemplateName)
        return
    }
    const keys = Array.isArray(template.variableKeys) ? template.variableKeys as string[] : []
    await enqueueWabaMessage({
        accountId: template.accountId,
        phone: context.phone || context.contactPhone,
        userId: context.userId,
        userEmail: context.email,
        flowStepId: step.id,
        templateName: template.name,
        language: template.language,
        params: templateParamsFromContext(keys, context),
        delayHours: step.delayHours || 0,
    })
}

export async function applyWabaWebhook(payload: any) {
    if (WABA_FEATURE_PAUSED) return
    const entries = Array.isArray(payload?.entry) ? payload.entry : []
    const fields = entries.flatMap((entry: any) => (Array.isArray(entry?.changes) ? entry.changes : []).map((change: any) => String(change?.field || ''))).filter(Boolean)
    await prisma.whatsAppAccount.updateMany({
        data: { lastWebhookAt: new Date(), lastWebhookFields: fields.slice(0, 8).join(',') || 'post' },
    }).catch(() => null)
    for (const entry of entries) {
        const changes = Array.isArray(entry?.changes) ? entry.changes : []
        for (const change of changes) {
            const field = String(change?.field || '')
            const value = change?.value || {}
            if (field === 'account_update') {
                const wabaId = String(value.waba_info?.waba_id || entry.id || '')
                const businessId = String(value.waba_info?.owner_business_id || '')
                const current = wabaId
                    ? await prisma.whatsAppAccount.findFirst({ where: { wabaId } })
                    : await getWabaAccount()
                if (current && businessId && !current.businessId) {
                    await upsertWabaAccount({ businessId }, current.id)
                }
            }
            if (field === 'message_template_status_update') {
                const metaId = String(value.message_template_id || '')
                const name = String(value.message_template_name || '')
                const status = String(value.event || value.message_template_status || '').toUpperCase()
                if (metaId || name) {
                    await prisma.whatsAppTemplate.updateMany({
                        where: metaId ? { metaId } : { name },
                        data: {
                            status: status.replace('TEMPLATE_', '') || status,
                            rejectionReason: value.reason ? String(value.reason) : undefined,
                        },
                    })
                }
            }
            const hasInbound = Array.isArray(value.messages) && value.messages.length
            const hasEchoes = Array.isArray(value.message_echoes) && value.message_echoes.length
            const hasHistory = field === 'history' || Array.isArray(value.history)
            if (field === 'messages' || field === 'smb_message_echoes' || field === 'history' || hasInbound || hasEchoes || hasHistory) {
                const phoneNumberId = String(value.metadata?.phone_number_id || '').trim()
                const inboundAccount = (phoneNumberId
                    ? await prisma.whatsAppAccount.findFirst({ where: { phoneNumberId } })
                    : null) || await getWabaAccount()
                const parsed = parseWabaWebhookMessages({ entry: [{ changes: [change] }] })
                if ((hasInbound || hasEchoes) && !parsed.length) {
                    const first = value.messages?.[0] || value.message_echoes?.[0] || {}
                    console.error('WABA_INBOUND_UNPARSED', JSON.stringify({
                        field,
                        from: first.from,
                        to: first.to,
                        type: first.type,
                        waId: value.contacts?.[0]?.wa_id,
                        keys: Object.keys(first),
                    }))
                }
                for (const inbound of parsed) {
                    await recordWabaMessage({
                        accountId: inboundAccount?.id || inboundAccount?.id || null,
                        phone: inbound.phone,
                        direction: inbound.direction || 'INBOUND',
                        type: inbound.type,
                        body: inbound.body,
                        metaMessageId: inbound.metaMessageId || null,
                        contactName: inbound.contactName || null,
                        status: inbound.direction === 'OUTBOUND' ? 'sent' : 'received',
                        raw: inbound.raw,
                        createdAt: inbound.timestamp,
                    }).catch((error: any) => console.error('WABA_INBOUND_STORE', error?.message || error))
                }
                const statuses = Array.isArray(value.statuses) ? value.statuses : []
                for (const item of statuses) {
                    const metaMessageId = String(item.id || '')
                    if (!metaMessageId) continue
                    const status = String(item.status || '')
                    await prisma.whatsAppMessage.updateMany({
                        where: { metaMessageId },
                        data: { status: status || undefined },
                    }).catch(() => null)
                    if (status === 'failed') {
                        await prisma.whatsAppQueue.updateMany({
                            where: { metaMessageId },
                            data: { status: 'FAILED', errorLogs: JSON.stringify(item.errors || item) },
                        })
                    }
                }
            }
        }
    }
}
