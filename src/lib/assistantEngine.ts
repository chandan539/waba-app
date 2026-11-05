import { getAssistantAdapters, getWabaPrisma } from './adapters'
import { askBusinessAssistant } from './assistantAi'
import {
    bookingServices,
    formatSlot,
    interactiveId,
    isHumanRequest,
    welcomeActions,
    type BotAction,
} from './assistantCore'
import { confirmBooking, holdBooking, listAvailableSlots, preparePayment } from './assistantBookings'
import { enqueueAssistantJob, getAssistantSettings } from './assistantStore'
import { signedBookingMediaUrl } from './assistantMedia'
import { isStopKeyword } from './waba'

async function transition(
    job: any,
    session: any,
    state: any,
    actions: BotAction[],
    handover?: boolean,
): Promise<BotAction[]> {
    await getWabaPrisma().$transaction(async (tx: any) => {
        if (handover)
            await tx.whatsAppAssistantJob.upsert({
                where: { key: `handover:${job.id}` },
                create: {
                    key: `handover:${job.id}`,
                    kind: 'HANDOVER',
                    payload: {},
                    accountId: job.accountId,
                    phone: job.phone,
                },
                update: {},
            })
        await tx.whatsAppAssistantSession.update({
            where: { id: session.id },
            data: { state, ...(handover === undefined ? {} : { handover }) },
        })
        await tx.whatsAppAssistantJob.update({ where: { id: job.id }, data: { plan: actions } })
    })
    return actions
}
async function handover(job: any, session: any, message: string): Promise<BotAction[]> {
    return transition(job, session, { handoverJob: job.id }, [{ type: 'text', text: message }], true)
}
async function slotsMenu(
    accountId: string,
    settings: any,
    from?: string,
    until?: string,
    serviceId?: string,
): Promise<BotAction[]> {
    if (!settings.bookingEnabled)
        return [{ type: 'text', text: 'Online booking is not enabled. Type human and our team will help.' }]
    let slots = await listAvailableSlots(accountId, from, until, serviceId)
    const validate = getAssistantAdapters().validateSlot
    if (settings.mode === 'LIVE' && validate) {
        const availability = await Promise.all(slots.map((slot: any) => validate(slot)))
        slots = slots.filter((_slot: any, index: number) => availability[index])
    }
    const services = bookingServices(settings)
    slots = slots.filter((slot: any) => services.some((service) => service.id === (slot.serviceId || 'default')))
    if (!slots.length)
        return [
            { type: 'text', text: 'No available slots for that period. Try another day, or type human for help.' },
        ]
    return [
        {
            type: 'menu',
            text: `Choose an available time${serviceId ? ` for ${services.find((service) => service.id === serviceId)?.name || 'your session'}` : ''}.
Times shown in ${settings.timezone}. Select a slot to hold it for 10 minutes.`,
            rows: slots.map((slot: any) => ({
                id: `slot:${slot.id}`,
                title: formatSlot(slot.startsAt, settings.timezone),
                description: (() => {
                    const service = services.find((service) => service.id === (slot.serviceId || 'default'))!
                    return `${service.name} · ${settings.currency} ${(service.priceMinor / 100).toFixed(2)}`
                })(),
            })),
        },
    ]
}
export async function planAssistantReply(job: any, session: any): Promise<BotAction[]> {
    const prisma = getWabaPrisma()
    const settings = await getAssistantSettings(job.accountId)
    const contact = await prisma.whatsAppContact.findUnique({
        where: { accountId_phone: { accountId: job.accountId, phone: job.phone } },
    })
    if (
        !settings.enabled ||
        contact?.optedOut ||
        session.handover ||
        (settings.mode === 'TEST' && !settings.testPhones.includes(job.phone))
    )
        return []
    const text = String(job.payload.text || '').trim()
    const tap = interactiveId(job.payload.raw)
    if (isStopKeyword(text)) return []
    if (tap === 'menu:human' || isHumanRequest(text)) return handover(job, session, settings.handoverMessage)
    if (/^(hi|hello|hey|menu|start|namaste|नमस्ते)$/i.test(text)) {
        return transition(job, session, {}, welcomeActions(settings))
    }
    if (tap === 'menu:guide')
        return settings.guideUrl
            ? [{ type: 'document', url: settings.guideUrl, caption: `${settings.businessName} · Your guide` }]
            : [{ type: 'text', text: 'Our guide is not available yet. Type human to ask the team.' }]
    if (tap === 'menu:ask')
        return [
            {
                type: 'text',
                text: 'Ask about our business, services or pricing. I’m an AI assistant; type human any time for our team.',
            },
        ]
    if (tap === 'menu:enquiry' || tap === 'menu:waitlist') {
        return transition(job, session, { step: tap === 'menu:waitlist' ? 'waitlist' : 'enquiry' }, [
            {
                type: 'text',
                text:
                    tap === 'menu:waitlist'
                        ? 'Send your email address to join our waitlist. We’ll store it with your WhatsApp number for updates. Send cancel to stop.'
                        : 'Share your name, email and what you need help with. We’ll save this enquiry so our team can follow up. Send cancel to stop.',
            },
        ])
    }
    if (/^cancel$/i.test(text)) {
        return transition(job, session, {}, welcomeActions(settings))
    }
    const state = session.state || {}
    if (state.step && !tap) {
        if (state.step === 'waitlist' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text))
            return [{ type: 'text', text: 'Please send a valid email address, or cancel.' }]
        const lead = await prisma.whatsAppLead.upsert({
            where: { sourceId: job.id },
            create: {
                accountId: job.accountId,
                phone: job.phone,
                kind: state.step,
                details: { text: text.slice(0, 4000), name: contact?.displayName || '' },
                sourceId: job.id,
            },
            update: {},
        })
        await enqueueAssistantJob(`lead:${lead.id}`, 'LEAD', { leadId: lead.id }, job.accountId, job.phone)
        const actions: BotAction[] = [
            {
                type: 'text',
                text:
                    state.step === 'waitlist'
                        ? 'You’re on the waitlist. Thanks for joining!'
                        : 'Thanks! Your enquiry has been saved for our team.',
            },
        ]
        if (state.step === 'enquiry' && settings.rateCardUrl)
            actions.push({
                type: 'image',
                url: settings.rateCardUrl,
                caption: `${settings.businessName} · Rate card`,
            })
        return transition(job, session, {}, actions)
    }
    if (tap === 'menu:book' || /^(book|book a call)$/i.test(text)) {
        if (!settings.bookingEnabled) return slotsMenu(job.accountId, settings)
        return [
            {
                type: 'menu',
                text: 'Choose a session. Times and availability are shown next.',
                rows: bookingServices(settings).map((service) => ({
                    id: `service:${service.id}`,
                    title: service.name.slice(0, 24),
                    description: service.priceMinor
                        ? `${settings.currency} ${(service.priceMinor / 100).toFixed(2)}`
                        : 'Free',
                })),
            },
        ]
    }
    if (tap.startsWith('service:')) return slotsMenu(job.accountId, settings, undefined, undefined, tap.slice(8))
    if (/^slots$/i.test(text)) return slotsMenu(job.accountId, settings)
    if (tap.startsWith('slot:')) {
        try {
            let booking = await holdBooking(job.accountId, job.phone, tap.slice(5), job.id, settings)
            if (booking.mode === 'TEST') {
                // A test never confirms payment, creates a real calendar event, or consumes a live slot indefinitely.
                const ticket = signedBookingMediaUrl(booking.id, 'ticket')
                if (ticket)
                    return [
                        {
                            type: 'image',
                            url: ticket,
                            caption: 'DEMO ONLY — no payment collected or real booking confirmed.',
                        },
                    ]
                return [
                    {
                        type: 'text',
                        text: `DEMO ONLY · ${settings.sessionName}\n${formatSlot(booking.startsAt, settings.timezone)} (${settings.timezone})\nTest ticket ${booking.id}. No payment collected and no real booking confirmed. Test hold expires in 10 minutes.`,
                    },
                ]
            }
            if (!booking.amountMinor) {
                booking = await confirmBooking(booking.id)
                return [] // The durable booking notification job sends the confirmation and ticket.
            }
            booking = await preparePayment(booking)
            const qr = signedBookingMediaUrl(booking.id, 'payment')
            const actions: BotAction[] = [
                {
                    type: 'text',
                    text: `Slot held for 10 minutes. Pay ${booking.currency} ${(booking.amountMinor / 100).toFixed(2)} using ${booking.paymentUrl}\nBooking ${booking.id}. Confirmation is sent only after our payment provider verifies your payment. “I’ve paid” or screenshots cannot confirm it.`,
                },
            ]
            if (qr)
                actions.push({
                    type: 'image',
                    url: qr,
                    caption: 'Scan to open our provider-hosted payment page. Your hold expires in 10 minutes.',
                })
            return actions
        } catch (error: any) {
            return [{ type: 'text', text: error.message }]
        }
    }
    if (tap) return welcomeActions(settings)
    if (job.payload.type !== 'text')
        return [
            {
                type: 'text',
                text: 'Thanks for the file. Please describe your request in text, or type human for our team.',
            },
        ]
    if (/\b(paid|payment done|payment sent)\b/i.test(text))
        return [
            {
                type: 'text',
                text: 'Payments are confirmed only after verification by our payment provider. If you need help, type human.',
            },
        ]
    if (!settings.aiEnabled) return welcomeActions(settings)
    try {
        const decision = await askBusinessAssistant(job.accountId, job.phone, text, settings)
        if (decision.intent === 'human') return handover(job, session, settings.handoverMessage)
        if (decision.intent === 'book') return slotsMenu(job.accountId, settings, decision.from, decision.until)
        return [{ type: 'text', text: decision.text || 'Please type human to speak with our team.' }]
    } catch {
        return handover(
            job,
            session,
            'I couldn’t complete that answer. I’ve asked our team to help; automated replies are paused.',
        )
    }
}
