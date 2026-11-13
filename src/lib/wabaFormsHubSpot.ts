import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { getWabaPrisma } from './adapters'

const contactsScope = 'crm.objects.contacts.write'

function oauthConfig() {
    const { WABA_HUBSPOT_CLIENT_ID: clientId, WABA_HUBSPOT_CLIENT_SECRET: clientSecret,
        WABA_HUBSPOT_REDIRECT_URI: redirectUri, WABA_HUBSPOT_TOKEN_KEY: tokenKey } = process.env
    if (!clientId || !clientSecret || !redirectUri || !tokenKey || !/^[a-f0-9]{64}$/i.test(tokenKey)) return null
    let url: URL
    try { url = new URL(redirectUri) } catch { return null }
    if (url.protocol !== 'https:' || url.search !== '?wabix_hubspot=1' || url.hash || url.username || url.password) return null
    return { clientId, clientSecret, redirectUri, key: Buffer.from(tokenKey, 'hex') }
}

function encrypt(value: string, key: Buffer) {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64')
}

function decrypt(value: string, key: Buffer) {
    const bytes = Buffer.from(value, 'base64')
    const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
    cipher.setAuthTag(bytes.subarray(12, 28))
    return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8')
}

export async function hubSpotStatus() {
    const connection = await getWabaPrisma().whatsAppFormsHubSpot.findUnique({ where: { id: 'default' }, select: { portalId: true } })
    return { configured: Boolean(oauthConfig()), portalId: connection?.portalId || '' }
}

export function hubSpotAuthorize(state: string) {
    const config = oauthConfig()
    if (!config) throw new Error('Configure HubSpot OAuth on the Wabix server first.')
    return 'https://app.hubspot.com/oauth/authorize?' + new URLSearchParams({
        client_id: config.clientId, redirect_uri: config.redirectUri, state,
        scope: contactsScope, optional_scope: 'forms',
    })
}

async function exchange(params: Record<string, string>) {
    const config = oauthConfig()
    if (!config) throw new Error('HubSpot OAuth is unavailable.')
    const response = await fetch('https://api.hubspot.com/oauth/2026-09/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...params }),
        redirect: 'error', signal: AbortSignal.timeout(12000),
    })
    if (!response.ok) throw new Error(`HubSpot authorization failed (HTTP ${response.status}). Reconnect HubSpot in Forms.`)
    const token = await response.json()
    if (!token.access_token) throw new Error('HubSpot did not issue an access token.')
    return { token, config }
}

export async function connectFormsHubSpot(code: string) {
    const config = oauthConfig()
    if (!config) throw new Error('Configure HubSpot OAuth on the Wabix server first.')
    const { token } = await exchange({ grant_type: 'authorization_code', code, redirect_uri: config.redirectUri })
    const portalId = String(token.hub_id || '')
    if (!/^\d+$/.test(portalId) || !token.refresh_token) throw new Error('HubSpot did not return a portal and refresh token.')
    const data = { portalId, refreshToken: encrypt(token.refresh_token, config.key) }
    await getWabaPrisma().whatsAppFormsHubSpot.upsert({
        where: { id: 'default' }, create: { id: 'default', ...data }, update: data,
    })
    return { portalId }
}

export async function formsHubSpotToken(portalId: string) {
    const config = oauthConfig()
    const store = getWabaPrisma().whatsAppFormsHubSpot
    const connection = await store.findUnique({ where: { id: 'default' } })
    if (!config || !connection || connection.portalId !== portalId) throw new Error('Reconnect the HubSpot portal selected for this form.')
    const refreshToken = decrypt(connection.refreshToken, config.key)
    const { token } = await exchange({ grant_type: 'refresh_token', refresh_token: refreshToken })
    if (token.refresh_token && token.refresh_token !== refreshToken) {
        await store.updateMany({ where: { id: 'default', refreshToken: connection.refreshToken }, data: { refreshToken: encrypt(token.refresh_token, config.key) } })
    }
    return String(token.access_token)
}
