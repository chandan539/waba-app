/**
 * Wire this module into the host app at boot:
 *
 *   import { setWabaAdapters } from './lib/adapters'
 *   setWabaAdapters({ prisma, requireAdmin, getAudiencePhones })
 */

export type WabaAudienceRow = { phone: string; userEmail?: string | null }

export type WabaAdapters = {
    prisma: any
    requireAdmin?: (req: any, res: any, next: any) => void
    getAudiencePhones?: (audience: string) => Promise<WabaAudienceRow[]>
}

const state: WabaAdapters = {
    prisma: null,
    requireAdmin: (_req, _res, next) => next(),
    getAudiencePhones: async () => [],
}

export function setWabaAdapters(next: WabaAdapters) {
    if (!next?.prisma) throw new Error('setWabaAdapters({ prisma }) is required')
    state.prisma = next.prisma
    if (next.requireAdmin) state.requireAdmin = next.requireAdmin
    if (next.getAudiencePhones) state.getAudiencePhones = next.getAudiencePhones
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
