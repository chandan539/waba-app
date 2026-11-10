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


type FacebookAuthResponse = { authResponse?: { code?: string }; status?: string }
export type FacebookSdk = {
    init: (options: { appId: string; version: string; cookie?: boolean; xfbml?: boolean }) => void
    login: (callback: (response: FacebookAuthResponse) => void, options: Record<string, unknown>) => void
}

/** Load Meta's JavaScript SDK and initialize Embedded Signup v4. */
export function loadFacebookSdk(appId: string, version = WABA_GRAPH_VERSION) {
    const w = window as Window & { FB?: FacebookSdk; fbAsyncInit?: () => void }
    const init = () => {
        w.FB?.init({ appId, version, cookie: true, xfbml: false })
        return w.FB!
    }
    if (w.FB) return Promise.resolve(init())
    return new Promise<FacebookSdk>((resolve, reject) => {
        w.fbAsyncInit = () => resolve(init())
        if (document.getElementById('facebook-jssdk')) {
            const wait = window.setInterval(() => {
                if (!w.FB) return
                window.clearInterval(wait)
                resolve(init())
            }, 50)
            window.setTimeout(() => window.clearInterval(wait), 8000)
            return
        }
        const script = document.createElement('script')
        script.id = 'facebook-jssdk'
        script.async = true
        script.src = 'https://connect.facebook.net/en_US/sdk.js'
        script.onerror = () => reject(new Error('Could not load Meta login. Refresh this page and try again.'))
        document.body.appendChild(script)
    })
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
