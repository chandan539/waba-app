import crypto from 'crypto'
import { wabaConfig } from './config'
import {
    WABA_EMBEDDED_SIGNUP_VERSION,
    WABA_FINISH_EVENTS,
    WABA_GRAPH_VERSION,
    isFacebookMessageOrigin,
    parseEmbeddedSignupMessage,
} from './wabaSignup'

export {
    WABA_EMBEDDED_SIGNUP_VERSION,
    WABA_FINISH_EVENTS,
    WABA_GRAPH_VERSION,
    isFacebookMessageOrigin,
    parseEmbeddedSignupMessage,
}

export const WABA_ACCOUNT_ID = 'waba'
export { WABA_FEATURE_PAUSED } from './wabaFlags'
export const WABA_TEMPLATE_CATEGORIES = ['UTILITY', 'MARKETING', 'AUTHENTICATION'] as const
export const WABA_AUDIENCES = ['ORDERS', 'LEADS', 'BOTH'] as const
export const WABA_CUSTOMER_CARE_HOURS = 24
export const DEFAULT_WABA_PIN = '123456'

export function normalizeWabaPin(pin?: string | null) {
    const value = String(pin || '').trim()
    return /^\d{6}$/.test(value) ? value : DEFAULT_WABA_PIN
}

export function isWabaCloudRegistered(phone?: { status?: string | null; platform_type?: string | null } | null) {
    return String(phone?.platform_type || '').toUpperCase() === 'CLOUD_API'
        && String(phone?.status || '').toUpperCase() === 'CONNECTED'
}

const brand = wabaConfig.brand
const shopHost = wabaConfig.shopHost()

export const EVENT_WABA_TEMPLATES = [
    { trigger: 'ACCOUNT_CREATED', name: 'test_account_ready', label: 'Test · Account ready', body: `Hello {{name}}, your ${brand} test account is ready. Visit ${shopHost} to review your account.` },
    { trigger: 'ORDER_PLACED', name: 'test_order_confirmation', label: 'Test · Order confirmation', body: `Hello {{name}}, this is a test confirmation for ${brand} order {{orderId}}. Amount {{total}}.` },
    { trigger: 'ORDER_SHIPPED', name: 'test_shipping_update', label: 'Test · Shipping update', body: `Hello {{name}}, this is a test shipping update for ${brand} order {{orderId}}. Tracking {{awb}}.` },
] as const

export { WABA_FLOW_TRIGGERS } from './wabaTriggers'

export function normalizeWabaPhone(phone?: string | null) {
    let digits = String(phone || '').replace(/\D/g, '')
    if (!digits) return ''
    if (digits.startsWith('0')) digits = digits.slice(1)
    if (digits.length === 10) digits = `${wabaConfig.defaultCountryCode}${digits}`
    if (digits.length < 8 || digits.length > 15) return ''
    return digits
}

export function isStopKeyword(text?: string | null) {
    return /^(stop|unsubscribe|optout|opt-out|cancel)$/i.test(String(text || '').trim())
}

export function isWabaCustomerCareOpen(lastInboundAt?: Date | string | null, now = new Date()) {
    if (!lastInboundAt) return false
    const start = new Date(lastInboundAt).getTime()
    if (!Number.isFinite(start)) return false
    return now.getTime() - start < WABA_CUSTOMER_CARE_HOURS * 60 * 60 * 1000
}

export function extractWabaMessageBody(message: any) {
    const type = String(message?.type || 'text')
    if (type === 'text') return { type, body: String(message?.text?.body || '').trim() }
    if (type === 'button') return { type, body: String(message?.button?.text || message?.button?.payload || '').trim() }
    if (type === 'interactive') {
        if (message.interactive?.type === 'nfm_reply') return { type, body: 'WhatsApp form submitted' }
        const reply = message?.interactive?.button_reply || message?.interactive?.list_reply || {}
        return { type, body: String(reply.title || reply.id || '').trim() }
    }
    if (type === 'image') return { type, body: String(message?.image?.caption || '[image]').trim() }
    if (type === 'video') return { type, body: String(message?.video?.caption || '[video]').trim() }
    if (type === 'audio') return { type, body: '[audio]' }
    if (type === 'document') return { type, body: String(message?.document?.filename || '[document]').trim() }
    if (type === 'sticker') return { type, body: '[sticker]' }
    if (type === 'location') return { type, body: '[location]' }
    if (type === 'contacts') return { type, body: '[contact]' }
    if (type === 'reaction') return { type, body: String(message?.reaction?.emoji || '[reaction]').trim() }
    return { type, body: `[${type}]` }
}

function pushWabaWebhookMessage(parsed: Array<{
    phone: string
    phoneNumberId: string
    direction: 'INBOUND' | 'OUTBOUND'
    type: string
    body: string
    metaMessageId: string
    contactName: string
    timestamp: Date
    raw: unknown
}>, message: any, phone: string, direction: 'INBOUND' | 'OUTBOUND', phoneNumberId: string, contactName: string) {
    const normalized = normalizeWabaPhone(phone)
    if (!normalized) return
    const extracted = extractWabaMessageBody(message)
    const ts = Number(message?.timestamp)
    parsed.push({
        phone: normalized,
        phoneNumberId,
        direction,
        type: extracted.type,
        body: extracted.body,
        metaMessageId: String(message?.id || ''),
        contactName,
        timestamp: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000) : new Date(),
        raw: message,
    })
}

export function parseWabaWebhookMessages(payload: any) {
    const parsed: Array<{
        phone: string
        phoneNumberId: string
        direction: 'INBOUND' | 'OUTBOUND'
        type: string
        body: string
        metaMessageId: string
        contactName: string
        timestamp: Date
        raw: unknown
    }> = []
    const entries = Array.isArray(payload?.entry) ? payload.entry : []
    for (const entry of entries) {
        const changes = Array.isArray(entry?.changes) ? entry.changes : []
        for (const change of changes) {
            const field = String(change?.field || '')
            const value = change?.value || {}
            const phoneNumberId = String(value.metadata?.phone_number_id || '').trim()
            const contacts = Array.isArray(value.contacts) ? value.contacts : []
            const nameByWaId = new Map<string, string>()
            for (const contact of contacts) {
                const waId = normalizeWabaPhone(contact?.wa_id)
                const name = String(contact?.profile?.name || '').trim()
                if (waId && name) nameByWaId.set(waId, name)
            }
            const fallbackWaId = normalizeWabaPhone(contacts[0]?.wa_id)
            const inbound = Array.isArray(value.messages) ? value.messages : []
            for (const message of inbound) {
                const phone = normalizeWabaPhone(message?.from || message?.author || message?.wa_id) || fallbackWaId
                pushWabaWebhookMessage(parsed, message, phone, 'INBOUND', phoneNumberId, nameByWaId.get(phone) || String(contacts[0]?.profile?.name || '').trim())
            }
            const echoes = Array.isArray(value.message_echoes) ? value.message_echoes : []
            for (const message of echoes) {
                const phone = normalizeWabaPhone(message?.to || message?.recipient || message?.from) || fallbackWaId
                pushWabaWebhookMessage(parsed, message, phone, 'OUTBOUND', phoneNumberId, nameByWaId.get(phone) || String(contacts[0]?.profile?.name || '').trim())
            }
            if (field === 'history' || Array.isArray(value.history)) {
                const chunks = Array.isArray(value.history) ? value.history : []
                for (const chunk of chunks) {
                    const threads = Array.isArray(chunk?.threads) ? chunk.threads : []
                    for (const thread of threads) {
                        const customer = normalizeWabaPhone(thread?.id)
                        const threadMessages = Array.isArray(thread?.messages) ? thread.messages : []
                        for (const message of threadMessages) {
                            const from = normalizeWabaPhone(message?.from)
                            const direction = from && customer && from !== customer ? 'OUTBOUND' : 'INBOUND'
                            pushWabaWebhookMessage(parsed, message, customer || from, direction, phoneNumberId, nameByWaId.get(customer || from) || '')
                        }
                    }
                }
            }
        }
    }
    return parsed
}

export function toMetaTemplateName(name: string) {
    return String(name || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 512)
}

export function toMetaTemplateBody(text: string) {
    const keys: string[] = []
    const body = String(text || '').replace(/\{\{(\w+)\}\}/g, (_, key) => {
        let index = keys.indexOf(key)
        if (index === -1) {
            keys.push(key)
            index = keys.length - 1
        }
        return `{{${index + 1}}}`
    })
    return { body, keys }
}

export function templateParamsFromContext(keys: string[], context: Record<string, unknown> = {}) {
    const aliases: Record<string, string[]> = {
        '1': ['name', 'firstName', 'customerName'],
        '2': ['email', 'orderId', 'phone', 'contactPhone'],
        '3': ['total', 'hospitalName', 'city'],
        name: ['name', 'firstName', 'customerName'],
        email: ['email'],
        phone: ['phone', 'contactPhone'],
        orderid: ['orderId', 'order_id'],
    }
    return keys.map((key, index) => {
        const direct = context[key]
        if (direct !== undefined && direct !== null && String(direct).trim()) return String(direct)
        for (const alias of aliases[String(key).toLowerCase()] || []) {
            const value = context[alias]
            if (value !== undefined && value !== null && String(value).trim()) return String(value)
        }
        if (index === 0) return String(context.name || context.firstName || 'there')
        if (index === 1) return String(context.email || context.phone || context.contactPhone || 'your email')
        return ' '
    })
}

export function buildTemplateComponents(bodyText: string, keys: string[]) {
    const component: Record<string, unknown> = { type: 'BODY', text: bodyText }
    if (keys.length) {
        const samples: Record<string, string> = {
            name: 'Doctor',
            orderId: 'AW-2401',
            total: 'Rs 240000',
            email: 'clinic@example.com',
            awb: '123456789012',
            phone: '9876543210',
            hospitalName: 'City Clinic',
        }
        component.example = {
            body_text: [keys.map((key) => samples[key] || (key === '1' ? 'Doctor' : key === '2' ? 'AW-2401' : 'value'))],
        }
    }
    return [component]
}

export function publicWabaStatus(account: {
    id?: string | null
    isSelected?: boolean | null
    metaAppId?: string | null
    embeddedSignupConfigId?: string | null
    wabaId?: string | null
    phoneNumberId?: string | null
    businessId?: string | null
    accessToken?: string | null
    metaAppSecret?: string | null
    verifyToken?: string | null
    displayName?: string | null
    displayPhone?: string | null
    qualityRating?: string | null
    connectedAt?: Date | string | null
    phoneStatus?: string | null
    platformType?: string | null
    codeVerificationStatus?: string | null
} | null, webhookUrl: string) {
    const wabaId = account?.wabaId || ''
    const phoneNumberId = account?.phoneNumberId || ''
    const hasToken = Boolean(account?.accessToken)
    const phoneStatus = String(account?.phoneStatus || '')
    const platformType = String(account?.platformType || '')
    return {
        id: account?.id || '',
        isSelected: Boolean(account?.isSelected),
        connected: Boolean(wabaId && phoneNumberId && hasToken),
        pendingPhone: Boolean(wabaId && hasToken && !phoneNumberId),
        cloudRegistered: isWabaCloudRegistered({ status: phoneStatus, platform_type: platformType }),
        phoneStatus,
        platformType,
        codeVerificationStatus: String(account?.codeVerificationStatus || ''),
        metaAppId: account?.metaAppId || '',
        embeddedSignupConfigId: account?.embeddedSignupConfigId || '',
        wabaId,
        phoneNumberId,
        businessId: account?.businessId || '',
        displayName: account?.displayName || '',
        displayPhone: account?.displayPhone || '',
        qualityRating: account?.qualityRating || '',
        connectedAt: account?.connectedAt || null,
        hasToken,
        hasAppSecret: Boolean(account?.metaAppSecret),
        verifyTokenSet: Boolean(account?.verifyToken),
        verifyToken: account?.verifyToken || '',
        webhookUrl,
        lastWebhookAt: (account as { lastWebhookAt?: Date | string | null } | null)?.lastWebhookAt || null,
        lastWebhookFields: (account as { lastWebhookFields?: string | null } | null)?.lastWebhookFields || '',
        graphVersion: WABA_GRAPH_VERSION,
        embeddedSignupVersion: WABA_EMBEDDED_SIGNUP_VERSION,
    }
}

export function publicWabaAccount(account: {
    id?: string | null
    isSelected?: boolean | null
    wabaId?: string | null
    phoneNumberId?: string | null
    accessToken?: string | null
    displayName?: string | null
    displayPhone?: string | null
    qualityRating?: string | null
    connectedAt?: Date | string | null
} | null) {
    const wabaId = account?.wabaId || ''
    const phoneNumberId = account?.phoneNumberId || ''
    const hasToken = Boolean(account?.accessToken)
    return {
        id: account?.id || '',
        isSelected: Boolean(account?.isSelected),
        connected: Boolean(wabaId && phoneNumberId && hasToken),
        pendingPhone: Boolean(wabaId && hasToken && !phoneNumberId),
        wabaId,
        phoneNumberId,
        displayName: account?.displayName || '',
        displayPhone: account?.displayPhone || '',
        qualityRating: account?.qualityRating || '',
        connectedAt: account?.connectedAt || null,
        label: account?.displayPhone || account?.displayName || phoneNumberId || wabaId || 'WhatsApp number',
    }
}

export function verifyMetaWebhookSignature(rawBody: Buffer | string, signatureHeader: string | undefined, appSecret: string) {
    if (!appSecret || !signatureHeader) return false
    const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')
    const provided = String(signatureHeader).replace(/^sha256=/, '')
    if (provided.length !== expected.length) return false
    try {
        return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
    } catch {
        return false
    }
}

export function graphUrl(path: string, query?: Record<string, string>) {
    const base = `https://graph.facebook.com/${WABA_GRAPH_VERSION}${path.startsWith('/') ? path : `/${path}`}`
    if (!query || !Object.keys(query).length) return base
    const params = new URLSearchParams(query)
    return `${base}?${params.toString()}`
}
