import crypto from 'crypto'
import { getAssistantAdapters, getWabaPrisma } from './adapters'
import { applyWabaWebhook, sendWabaTemplate } from './wabaService'
import { deliverAssistantAction } from './assistantTransport'
import { planAssistantReply } from './assistantEngine'
import { expireBookingHolds, scheduleBookingReminders } from './assistantBookings'
import { getAssistantSettings } from './assistantStore'
import { formatSlot } from './assistantCore'
import { signedBookingMediaUrl } from './assistantMedia'
import { WABA_FEATURE_PAUSED } from './wabaFlags'

const LEASE_MS = 120000
async function processJob(job: any) {
    const prisma = getWabaPrisma()
    const adapters = getAssistantAdapters()
    if (job.kind === 'WEBHOOK') return applyWabaWebhook(job.payload)
    if (job.kind === 'CANCEL_PAYMENT') {
        const booking = await prisma.whatsAppBooking.findUnique({ where: { id: job.payload.bookingId } })
        if (booking?.status === 'EXPIRED' && adapters.cancelPayment) await adapters.cancelPayment(booking, job.key)
        return
    }
    if (job.kind === 'LEAD') {
        const lead = await prisma.whatsAppLead.findUnique({ where: { id: job.payload.leadId } })
        if (lead && adapters.onLead) await adapters.onLead(lead, job.key)
        return
    }
    if (job.kind === 'HANDOVER') {
        if (adapters.onHandover) await adapters.onHandover({ accountId: job.accountId, phone: job.phone }, job.key)
        return
    }
    if (job.kind === 'REMINDER') {
        const booking = await prisma.whatsAppBooking.findUnique({ where: { id: job.payload.bookingId } })
        const settings = await getAssistantSettings(job.accountId)
        if (
            !settings.enabled ||
            settings.mode !== 'LIVE' ||
            booking?.status !== 'CONFIRMED' ||
            booking.mode !== 'LIVE' ||
            +booking.startsAt <= Date.now()
        )
            return
        // External template sends cannot be made atomic with our DB. Record intent and block ambiguous retries.
        const key = `${job.key}:template`
        if (await prisma.whatsAppAssistantDelivery.findUnique({ where: { key } }))
            throw new Error('Reminder send already attempted; review delivery before retry')
        await prisma.whatsAppAssistantDelivery.create({
            data: { key, accountId: job.accountId, phone: job.phone, payload: job.payload },
        })
        try {
            const sent = await sendWabaTemplate({
                accountId: job.accountId,
                phone: job.phone,
                templateName: job.payload.templateName,
                context: {
                    name: 'there',
                    bookingId: booking.id,
                    date: formatSlot(booking.startsAt, settings.timezone),
                    time: formatSlot(booking.startsAt, settings.timezone),
                },
            })
            await prisma.whatsAppAssistantDelivery.update({
                where: { key },
                data: { status: 'SENT', metaMessageId: sent.metaMessageId },
            })
        } catch (error) {
            await prisma.whatsAppAssistantDelivery.update({
                where: { key },
                data: { status: 'REVIEW', error: 'Template send failed or outcome unknown' },
            })
            throw error
        }
        return
    }
    if (job.kind === 'BOOKING_CONFIRMED') {
        let booking = await prisma.whatsAppBooking.findUnique({ where: { id: job.payload.bookingId } })
        if (!booking || booking.status !== 'CONFIRMED') return
        if (!booking.calendarSynced && adapters.confirmBooking) {
            const event = await adapters.confirmBooking(booking, booking.id)
            booking = await prisma.whatsAppBooking.update({
                where: { id: booking.id },
                data: {
                    calendarSynced: true,
                    calendarId: event.externalId || null,
                    meetingUrl: event.meetingUrl || null,
                },
            })
        }
        const settings = await getAssistantSettings(job.accountId)
        const ticket = signedBookingMediaUrl(booking.id, 'ticket')
        if (ticket)
            await deliverAssistantAction(`${job.key}:ticket`, job.accountId, job.phone, {
                type: 'image',
                url: ticket,
                caption: `Confirmed · ${booking.sessionName} · ${booking.id}`,
            })
        return deliverAssistantAction(`${job.key}:notice`, job.accountId, job.phone, {
            type: 'text',
            text: `Booking confirmed · ${booking.sessionName}\nTicket ${booking.id}\n${formatSlot(booking.startsAt, settings.timezone)} (${settings.timezone})${booking.meetingUrl ? `\nJoin: ${booking.meetingUrl}` : ''}`,
        })
    }
    if (job.kind !== 'INBOUND') throw new Error(`Unknown assistant job kind ${job.kind}`)
    const earlier = await prisma.whatsAppAssistantJob.count({
        where: {
            kind: 'INBOUND',
            accountId: job.accountId,
            phone: job.phone,
            createdAt: { lt: job.createdAt },
            status: { in: ['PENDING', 'PROCESSING'] },
        },
    })
    if (earlier) throw new Error('Waiting for an earlier conversation message')
    const identity = { accountId: job.accountId, phone: job.phone }
    const session = await prisma.whatsAppAssistantSession.upsert({
        where: { accountId_phone: identity },
        create: { ...identity, state: {} },
        update: {},
    })
    const token = crypto.randomUUID()
    const lock = await prisma.whatsAppAssistantSession.updateMany({
        where: { id: session.id, OR: [{ lockUntil: null }, { lockUntil: { lt: new Date() } }] },
        data: { lockToken: token, lockUntil: new Date(Date.now() + LEASE_MS) },
    })
    if (!lock.count) throw new Error('Conversation is processing another message')
    const sessionHeartbeat = setInterval(() => {
        prisma.whatsAppAssistantSession
            .updateMany({
                where: { id: session.id, lockToken: token },
                data: { lockUntil: new Date(Date.now() + LEASE_MS) },
            })
            .catch(() => null)
    }, 30000)
    try {
        const current = await prisma.whatsAppAssistantSession.findUnique({ where: { id: session.id } })
        let plan = job.plan
        if (!plan) {
            plan = await planAssistantReply(job, current)
            await prisma.whatsAppAssistantJob.update({ where: { id: job.id }, data: { plan } })
        }
        for (let i = 0; i < plan.length; i++) {
            const settings = await getAssistantSettings(job.accountId)
            const latest = await prisma.whatsAppAssistantSession.findUnique({ where: { id: session.id } })
            // A concurrent operator handover must stop any cached AI/menu reply.
            if (!settings.enabled || (settings.mode === 'TEST' && !settings.testPhones.includes(job.phone))) break
            if (latest.handover && latest.state?.handoverJob !== job.id) break
            await deliverAssistantAction(`${job.key}:${i}`, job.accountId, job.phone, plan[i])
        }
    } finally {
        clearInterval(sessionHeartbeat)
        await prisma.whatsAppAssistantSession.updateMany({
            where: { id: session.id, lockToken: token },
            data: { lockToken: null, lockUntil: null },
        })
    }
}
/** Run from an always-on worker every few seconds. Safe for multiple workers through DB leases. */
export async function processAssistantJobs(limit = 20) {
    if (WABA_FEATURE_PAUSED) return { processed: 0, failed: 0 }
    const prisma = getWabaPrisma()
    await expireBookingHolds()
    await scheduleBookingReminders()
    const jobs = await prisma.whatsAppAssistantJob.findMany({
        where: {
            OR: [
                { status: 'PENDING', availableAt: { lte: new Date() } },
                { status: 'PROCESSING', leaseUntil: { lt: new Date() } },
            ],
        },
        orderBy: { createdAt: 'asc' },
        take: Math.min(limit, 100),
    })
    let processed = 0,
        failed = 0
    for (const job of jobs) {
        const token = crypto.randomUUID()
        const claim = await prisma.whatsAppAssistantJob.updateMany({
            where: {
                id: job.id,
                OR: [
                    { status: 'PENDING', availableAt: { lte: new Date() } },
                    { status: 'PROCESSING', leaseUntil: { lt: new Date() } },
                ],
            },
            data: {
                status: 'PROCESSING',
                leaseToken: token,
                leaseUntil: new Date(Date.now() + LEASE_MS),
                attempts: { increment: 1 },
            },
        })
        if (!claim.count) continue
        const heartbeat = setInterval(() => {
            prisma.whatsAppAssistantJob
                .updateMany({
                    where: { id: job.id, leaseToken: token },
                    data: { leaseUntil: new Date(Date.now() + LEASE_MS) },
                })
                .catch(() => null)
        }, 30000)
        try {
            await processJob(job)
            await prisma.whatsAppAssistantJob.updateMany({
                where: { id: job.id, leaseToken: token },
                data: { status: 'DONE', leaseUntil: null, error: null },
            })
            processed++
        } catch (error: any) {
            const attempts = job.attempts + 1
            await prisma.whatsAppAssistantJob.updateMany({
                where: { id: job.id, leaseToken: token },
                data: {
                    status: attempts >= 5 ? 'FAILED' : 'PENDING',
                    availableAt: new Date(Date.now() + Math.min(300000, 5000 * 2 ** attempts)),
                    leaseUntil: null,
                    error: String(error.message).slice(0, 800),
                },
            })
            failed++
        } finally {
            clearInterval(heartbeat)
        }
    }
    return { processed, failed }
}
