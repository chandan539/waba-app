/** Host-app settings. Set these in .env — never commit secrets. */

function env(name: string, fallback = '') {
    return String(process.env[name] || fallback).trim()
}

function stripSlash(value: string) {
    return value.replace(/\/$/, '')
}

export const wabaConfig = {
    brand: env('WABA_BRAND', 'Your Brand'),
    shopUrl: stripSlash(env('WABA_SHOP_URL', 'https://example.com')),
    shopHost() {
        return this.shopUrl.replace(/^https?:\/\//, '')
    },
    webhookUrl: env('WABA_WEBHOOK_URL'),
    apiOrigin: stripSlash(env('WABA_API_ORIGIN', env('API_URL', ''))),
    adminOrigin: stripSlash(env('WABA_ADMIN_ORIGIN', 'http://localhost:3000')),
    extraOauthOrigins: env('WABA_OAUTH_ORIGINS')
        .split(',')
        .map((item) => stripSlash(item.trim()))
        .filter(Boolean),
    defaultCountryCode: env('WABA_DEFAULT_CC', '91'),
    graphVersion: env('WABA_GRAPH_VERSION', 'v26.0'),
    oauthPath: env('WABA_OAUTH_PATH', '/admin/waba'),
}

export function resolveWabaWebhookUrl() {
    if (wabaConfig.webhookUrl) return wabaConfig.webhookUrl
    if (wabaConfig.apiOrigin && !/localhost|127\.0\.0\.1/.test(wabaConfig.apiOrigin)) {
        return `${wabaConfig.apiOrigin}/api/whatsapp/webhook`
    }
    throw new Error('Set WABA_WEBHOOK_URL to a public HTTPS URL, e.g. https://api.example.com/api/whatsapp/webhook')
}
