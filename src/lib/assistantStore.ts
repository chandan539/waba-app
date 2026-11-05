import crypto from 'crypto'
import { getWabaPrisma } from './adapters'
import { assistantDefaults, validateAssistantSettings } from './assistantCore'
import type { AssistantSettings } from './assistantTypes'
export async function getAssistantSettings(accountId: string): Promise<AssistantSettings> {
    const row = await getWabaPrisma().whatsAppAssistantConfig.findUnique({ where: { accountId } })
    return { ...assistantDefaults, ...row?.settings }
}
export async function saveAssistantSettings(accountId: string, input: unknown) {
    const settings = validateAssistantSettings(input)
    await getWabaPrisma().whatsAppAssistantConfig.upsert({
        where: { accountId },
        create: { accountId, settings },
        update: { settings },
    })
    return settings
}
export async function enqueueAssistantJob(
    key: string,
    kind: string,
    payload: any,
    accountId?: string,
    phone?: string,
) {
    return getWabaPrisma().whatsAppAssistantJob.upsert({
        where: { key },
        create: { key, kind, payload, accountId, phone },
        update: {},
    })
}
export async function storeWebhook(payload: unknown, raw: Buffer) {
    const key = `webhook:${crypto.createHash('sha256').update(raw).digest('hex')}`
    return enqueueAssistantJob(key, 'WEBHOOK', payload)
}
