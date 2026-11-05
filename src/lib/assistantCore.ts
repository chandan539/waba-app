import type { AssistantSettings } from './assistantTypes'
import { normalizeWabaPhone } from './waba'

import { assistantDefaults } from './assistantDefaults'
export { assistantDefaults } from './assistantDefaults'

export function publicMediaUrl(value: unknown) {
    const text = String(value || '').trim()
    if (!text) return ''
    const url = new URL(text)
    if (url.protocol !== 'https:' || url.username || url.password)
        throw new Error('Media and payment links must use HTTPS')
    return url.toString()
}
export function validateAssistantSettings(input: any): AssistantSettings {
    const next = { ...assistantDefaults }
    for (const key of Object.keys(next) as Array<keyof AssistantSettings>) {
        if (!(key in (input || {}))) continue
        if (typeof next[key] === 'string') (next as any)[key] = String(input[key]).trim()
        else if (typeof next[key] === 'boolean') {
            if (typeof input[key] !== 'boolean') throw new Error(`${key} must be true or false`)
            ;(next as any)[key] = input[key]
        }
    }
    if (!['TEST', 'LIVE'].includes(next.mode)) throw new Error('Choose TEST or LIVE mode')
    new Intl.DateTimeFormat('en', { timeZone: next.timezone })
    next.menuLabels = { ...assistantDefaults.menuLabels }
    for (const key of Object.keys(next.menuLabels)) {
        const label = String(input?.menuLabels?.[key] || next.menuLabels[key]).trim()
        if (!label || label.length > 24) throw new Error('Menu labels must be 1–24 characters')
        next.menuLabels[key] = label
    }
    next.testPhones = Array.isArray(input?.testPhones)
        ? ([...new Set(input.testPhones.map(normalizeWabaPhone).filter(Boolean))] as string[])
        : []
    next.bookingServices = Array.isArray(input?.bookingServices)
        ? input.bookingServices.map((service: any) => ({
              id: String(service.id || ''),
              name: String(service.name || '').trim(),
              priceMinor: Number(service.priceMinor),
          }))
        : []
    if (
        next.bookingServices.length > 9 ||
        new Set(next.bookingServices.map((service) => service.id)).size !== next.bookingServices.length ||
        next.bookingServices.some(
            (service) =>
                !/^[a-zA-Z0-9_-]{1,64}$/.test(service.id) ||
                service.id === 'default' ||
                !service.name ||
                service.name.length > 100 ||
                !Number.isSafeInteger(service.priceMinor) ||
                service.priceMinor < 0 ||
                service.priceMinor > 100000000,
        )
    )
        throw new Error(
            'Additional sessions need unique IDs, names and valid minor-unit prices; at most nine are allowed',
        )
    next.priceMinor = Number(input?.priceMinor ?? 0)
    next.maxDailyAiCalls = Number(input?.maxDailyAiCalls ?? 50)
    if (!Number.isSafeInteger(next.priceMinor) || next.priceMinor < 0 || next.priceMinor > 100000000)
        throw new Error('Price must be a nonnegative integer in minor units')
    if (!Number.isInteger(next.maxDailyAiCalls) || next.maxDailyAiCalls < 1 || next.maxDailyAiCalls > 10000)
        throw new Error('Daily AI call limit must be 1–10000')
    if (!/^[A-Z]{3}$/.test(next.currency)) throw new Error('Use a three-letter uppercase currency code')
    if (!next.businessName || next.businessName.length > 100 || next.sessionName.length > 100)
        throw new Error('Business and session names must be 1–100 characters')
    if (
        next.knowledge.length > 40000 ||
        next.welcome.length > 1000 ||
        next.handoverMessage.length > 1000 ||
        next.tone.length > 2000
    )
        throw new Error('Business text exceeds its size limit')
    for (const key of ['bannerUrl', 'guideUrl', 'rateCardUrl'] as const) next[key] = publicMediaUrl(next[key])
    if (next.enabled && next.mode === 'TEST' && !next.testPhones.length)
        throw new Error('Add at least one test phone before enabling test mode')
    if (next.aiEnabled && (!next.knowledge || !(next.model || process.env.CLAUDE_MODEL)))
        throw new Error('AI requires business knowledge and a model ID')
    return next
}
export type BotAction =
    | { type: 'text'; text: string }
    | { type: 'menu'; text: string; rows: Array<{ id: string; title: string; description?: string }> }
    | { type: 'image' | 'document'; url: string; caption: string }
export const menuRows = [
    { id: 'menu:enquiry', title: 'Business enquiry' },
    { id: 'menu:book', title: 'Book a call' },
    { id: 'menu:guide', title: 'Get our guide' },
    { id: 'menu:waitlist', title: 'Join the waitlist' },
    { id: 'menu:ask', title: 'Ask a question' },
    { id: 'menu:human', title: 'Talk to a human' },
]
export function welcomeActions(settings: AssistantSettings): BotAction[] {
    const actions: BotAction[] = []
    if (settings.bannerUrl)
        actions.push({ type: 'image', url: settings.bannerUrl, caption: settings.businessName })
    actions.push({
        type: 'menu',
        text: `${settings.welcome}\n${settings.mode === 'TEST' ? 'TEST MODE — no real payment or calendar booking.\n' : ''}Type “human” at any time to reach our team.`,
        rows: menuRows
            .filter((row) => settings.bookingEnabled || row.id !== 'menu:book')
            .map((row) => ({ ...row, title: settings.menuLabels?.[row.id.slice(5)] || row.title })),
    })
    return actions
}
export function interactiveId(raw: any): string {
    return String(
        raw?.interactive?.list_reply?.id || raw?.interactive?.button_reply?.id || raw?.button?.payload || '',
    )
}
export function isHumanRequest(text: string) {
    return /^(human|agent|person|talk to (a )?human|team|insaan)$/i.test(text.trim())
}
export function formatSlot(startsAt: Date | string, timezone: string) {
    return new Intl.DateTimeFormat('en-IN', {
        timeZone: timezone,
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    }).format(new Date(startsAt))
}
export function availableSlotWhere(accountId: string, now = new Date()) {
    return { accountId, startsAt: { gt: now }, OR: [{ bookingId: null }, { reservedUntil: { lt: now } }] }
}

export function bookingServices(settings: AssistantSettings) {
    return [
        { id: 'default', name: settings.sessionName, priceMinor: settings.priceMinor },
        ...(settings.bookingServices || []),
    ]
}
