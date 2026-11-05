import { webhookWabaUpdater, type WabaUpdateAdapter } from './wabaUpdates'
import type { AssistantAdapters } from './assistantTypes'
/**
 * Wire this module into the host app at boot:
 *
 *   import { setWabaAdapters } from './lib/adapters'
 *   setWabaAdapters({ prisma, requireAdmin, getAudiencePhones })
 */

export type WabaAudienceRow = { phone: string; userEmail?: string | null }

export type WabaAdapters = {
    prisma: any
    assistant?: AssistantAdapters
    updateWaba?: WabaUpdateAdapter
    requireAdmin?: (req: any, res: any, next: any) => void
    getAudiencePhones?: (audience: string) => Promise<WabaAudienceRow[]>
}

const unavailableAdmin: NonNullable<WabaAdapters['requireAdmin']> = (_req, res) =>
    res.status(503).json({ error: 'WABA admin authentication adapter is required' })

const state: WabaAdapters = {
    prisma: null,
    requireAdmin: unavailableAdmin,
    getAudiencePhones: async () => [],
}

export function setWabaAdapters(next: WabaAdapters) {
    if (!next?.prisma) throw new Error('setWabaAdapters({ prisma }) is required')
    state.prisma = next.prisma
    const hook = process.env.WABA_UPDATE_HOOK_URL
    const token = process.env.WABA_UPDATE_HOOK_TOKEN
    state.updateWaba = next.updateWaba || (hook && token ? webhookWabaUpdater(hook, token) : undefined)
    state.assistant = next.assistant || {}
    state.requireAdmin = next.requireAdmin || unavailableAdmin
    state.getAudiencePhones = next.getAudiencePhones || (async () => [])
}

export function getWabaPrisma() {
    if (!state.prisma) {
        throw new Error('WABA is not wired. Call setWabaAdapters({ prisma }) at API boot.')
    }
    return state.prisma
}

export function wabaRequireAdmin(req: any, res: any, next: any) {
    return state.requireAdmin!(req, res, next)
}

export async function hostAudiencePhones(audience: string) {
    return state.getAudiencePhones!(audience)
}

export function getAssistantAdapters(): AssistantAdapters { return state.assistant || {} }

export function getWabaUpdater() { return state.updateWaba }
