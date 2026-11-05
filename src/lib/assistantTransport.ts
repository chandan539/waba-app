import { getWabaPrisma } from './adapters'
import { getWabaAccount, recordWabaMessage } from './wabaService'
import { graphUrl, isWabaCustomerCareOpen, normalizeWabaPhone } from './waba'
import type { BotAction } from './assistantCore'

export function actionPayload(action: BotAction): any {
    if (action.type === 'text')
        return { type: 'text', text: { body: action.text.slice(0, 4096), preview_url: false } }
    if (action.type === 'menu')
        return {
            type: 'interactive',
            interactive: {
                type: 'list',
                body: { text: action.text.slice(0, 1024) },
                action: {
                    button: 'Choose an option',
                    sections: [
                        {
                            title: 'Available options',
                            rows: action.rows
                                .slice(0, 10)
                                .map((row) => ({
                                    id: row.id.slice(0, 200),
                                    title: row.title.slice(0, 24),
                                    ...(row.description ? { description: row.description.slice(0, 72) } : {}),
                                })),
                        },
                    ],
                },
            },
        }
    return {
        type: action.type,
        [action.type]: {
            link: action.url,
            caption: action.caption.slice(0, 1024),
            ...(action.type === 'document' ? { filename: 'business-guide.pdf' } : {}),
        },
    }
}
/** Persist send intent before the external request. Ambiguous sends require operator review, not blind retries. */
export async function deliverAssistantAction(
    key: string,
    accountId: string,
    inputPhone: string,
    action: BotAction,
) {
    const prisma = getWabaPrisma()
    const phone = normalizeWabaPhone(inputPhone)
    const previous = await prisma.whatsAppAssistantDelivery.findUnique({ where: { key } })
    if (previous?.status === 'SENT' || previous?.status === 'SKIPPED') return
    if (previous) throw new Error(`Delivery ${key} needs review (${previous.status}); automatic resend blocked`)
    const contact = await prisma.whatsAppContact.findUnique({ where: { accountId_phone: { accountId, phone } } })
    if (contact?.optedOut || !isWabaCustomerCareOpen(contact?.lastInboundAt)) {
        await prisma.whatsAppAssistantDelivery.create({
            data: {
                key,
                accountId,
                phone,
                payload: action,
                status: 'SKIPPED',
                error: contact?.optedOut
                    ? 'Contact opted out'
                    : '24-hour service window closed; approved template required',
            },
        })
        return
    }
    const account = await getWabaAccount(accountId)
    if (!account?.accessToken || !account.phoneNumberId) throw new Error('WhatsApp number is not connected')
    const payload = { messaging_product: 'whatsapp', to: phone, ...actionPayload(action) }
    await prisma.whatsAppAssistantDelivery.create({ data: { key, accountId, phone, payload } })
    try {
        const response = await fetch(graphUrl(`/${account.phoneNumberId}/messages`), {
            method: 'POST',
            signal: AbortSignal.timeout(15000),
            headers: { authorization: `Bearer ${account.accessToken}`, 'content-type': 'application/json' },
            body: JSON.stringify(payload),
        })
        const data: any = await response.json()
        if (!response.ok)
            throw new Error(
                `WhatsApp rejected delivery (${response.status}, code ${data.error?.code || 'unknown'})`,
            )
        const metaMessageId = data.messages?.[0]?.id || null
        await prisma.whatsAppAssistantDelivery.update({ where: { key }, data: { status: 'SENT', metaMessageId } })
        await recordWabaMessage({
            accountId,
            phone,
            direction: 'OUTBOUND',
            type: payload.type,
            body: action.type === 'text' ? action.text : action.type === 'menu' ? action.text : action.caption,
            metaMessageId,
            raw: data,
        })
    } catch (error: any) {
        await prisma.whatsAppAssistantDelivery.update({
            where: { key },
            data: { status: 'REVIEW', error: String(error.message).slice(0, 500) },
        })
        throw error
    }
}
