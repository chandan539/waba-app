import { wabaConfig } from './config'

export const WABA_GRAPH_VERSION = wabaConfig.graphVersion
export const WABA_EMBEDDED_SIGNUP_VERSION = 'v4'
export const WABA_OAUTH_REDIRECT_PATH = wabaConfig.oauthPath
export const WABA_OAUTH_DEFAULT_ORIGIN = wabaConfig.adminOrigin

export function wabaOauthRedirectUri(origin?: string) {
    const base = String(origin || WABA_OAUTH_DEFAULT_ORIGIN).trim().replace(/\/$/, '')
    return `${base}${WABA_OAUTH_REDIRECT_PATH}`
}

export function isAllowedWabaOauthRedirectUri(uri: string) {
    try {
        const url = new URL(String(uri || '').trim())
        if (url.username || url.password || !['https:', 'http:'].includes(url.protocol)) return false
        if (url.pathname !== WABA_OAUTH_REDIRECT_PATH) return false
        if (url.search || url.hash) return false
        const origin = `${url.protocol}//${url.host}`.replace(/\/$/, '')
        const allowed = new Set([
            WABA_OAUTH_DEFAULT_ORIGIN.replace(/\/$/, ''),
            ...wabaConfig.extraOauthOrigins,
        ])
        const host = url.hostname.toLowerCase()
        if ((host === 'localhost' || host === '127.0.0.1') && (url.protocol === 'http:' || url.protocol === 'https:')) return true
        return url.protocol === 'https:' && allowed.has(origin)
    } catch {
        return false
    }
}

export const WABA_FINISH_EVENTS = [
    'FINISH',
    'FINISH_ONLY_WABA',
    'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
    'FINISH_OBO_MIGRATION',
    'FINISH_GRANT_ONLY_API_ACCESS',
] as const

export function isFacebookMessageOrigin(origin: string) {
    try {
        const url = new URL(origin)
        return url.origin === origin && url.protocol === 'https:'
            && (url.hostname === 'facebook.com' || url.hostname.endsWith('.facebook.com'))
    } catch {
        return false
    }
}

export function parseEmbeddedSignupMessage(raw: unknown) {
    let payload: any = raw
    if (typeof raw === 'string') {
        try {
            payload = JSON.parse(raw)
        } catch {
            return null
        }
    }
    if (!payload || typeof payload !== 'object' || payload.type !== 'WA_EMBEDDED_SIGNUP') return null
    const inner = payload.data && typeof payload.data === 'object' ? payload.data : {}
    const wabaIds = Array.isArray(inner.waba_ids) ? inner.waba_ids.map((id: unknown) => String(id || '')).filter(Boolean) : []
    const event = String(payload.event || '')
    return {
        event,
        finished: WABA_FINISH_EVENTS.includes(event as (typeof WABA_FINISH_EVENTS)[number]),
        cancelled: event === 'CANCEL',
        wabaId: String(inner.waba_id || wabaIds[0] || ''),
        phoneNumberId: String(inner.phone_number_id || ''),
        businessId: String(inner.business_id || ''),
        currentStep: String(inner.current_step || ''),
        errorMessage: String(inner.error_message || ''),
        errorCode: String(inner.error_code || ''),
        sessionId: String(inner.session_id || ''),
    }
}

export function embeddedSignupDialogUrl(input: {
    appId: string
    configId: string
    redirectUri: string
    version?: string
    state?: string
}) {
    const params = new URLSearchParams({
        client_id: String(input.appId || '').trim(),
        config_id: String(input.configId || '').trim(),
        response_type: 'code',
        override_default_response_type: 'true',
        redirect_uri: input.redirectUri,
        display: 'popup',
        extras: JSON.stringify({ setup: {} }),
    })
    if (input.state) params.set('state', input.state)
    const version = input.version || 'v21.0'
    return `https://www.facebook.com/${version}/dialog/oauth?${params.toString()}`
}
