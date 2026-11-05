import crypto from 'crypto'
import { getAssistantAdapters, getWabaPrisma } from './adapters'
import { availableSlotWhere, bookingServices, publicMediaUrl } from './assistantCore'
import { enqueueAssistantJob, getAssistantSettings } from './assistantStore'
import type { AssistantSettings, PaymentReceipt } from './assistantTypes'

export async function listAvailableSlots(accountId: string, from?: string, until?: string, serviceId?: string) {
    const now = new Date()
    const start = from ? new Date(from) : now
    const end = until ? new Date(until) : new Date(now.getTime() + 30 * 86400000)
    if (!Number.isFinite(+start) || !Number.isFinite(+end) || +end <= Math.max(+now, +start))
        throw new Error('Invalid slot search dates')
    return getWabaPrisma().whatsAppBookingSlot.findMany({
        where: {
            ...availableSlotWhere(accountId, now),
            ...(serviceId ? { serviceId } : {}),
            startsAt: { gt: new Date(Math.max(+now, +start)), lt: end },
        },
        orderBy: { startsAt: 'asc' },
        take: 10,
    })
}
export async function holdBooking(
    accountId: string,
    phone: string,
    slotId: string,
    sourceId: string,
    settings: AssistantSettings,
) {
    if (!settings.bookingEnabled) throw new Error('Bookings are disabled')
    const prisma = getWabaPrisma()
    const existing = await prisma.whatsAppBooking.findUnique({ where: { sourceId } })
    if (existing) return existing
    const slot = await prisma.whatsAppBookingSlot.findFirst({
        where: { id: slotId, ...availableSlotWhere(accountId) },
    })
    const service =
        slot && bookingServices(settings).find((service) => service.id === (slot.serviceId || 'default'))
    if (!service) throw new Error('This session is no longer available')
    if (settings.mode === 'LIVE' && service.priceMinor > 0 && !getAssistantAdapters().createPayment)
        throw new Error('Payment integration is not configured')
    if (!slot) throw new Error('That slot is no longer available. Open Book a call again.')
    if (
        settings.mode === 'LIVE' &&
        getAssistantAdapters().validateSlot &&
        !(await getAssistantAdapters().validateSlot!(slot))
    )
        throw new Error('Calendar availability has changed. Choose another slot.')
    const id = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 10 * 60000)
    return prisma.$transaction(async (tx: any) => {
        const claim = await tx.whatsAppBookingSlot.updateMany({
            where: { id: slotId, ...availableSlotWhere(accountId) },
            data: { bookingId: id, reservedUntil: expiresAt },
        })
        if (!claim.count) throw new Error('Someone just selected this slot. Please choose another.')
        return tx.whatsAppBooking.create({
            data: {
                id,
                accountId,
                phone,
                slotId,
                sessionName: service.name,
                startsAt: slot.startsAt,
                endsAt: slot.endsAt,
                expiresAt,
                status: 'HELD',
                mode: settings.mode,
                amountMinor: service.priceMinor,
                currency: settings.currency,
                sourceId,
            },
        })
    })
}
export async function preparePayment(booking: any) {
    if (booking.paymentUrl) return booking
    const adapter = getAssistantAdapters().createPayment
    if (!adapter) throw new Error('Payments are not configured. Please talk to the team.')
    const payment = await adapter({
        bookingId: booking.id,
        amountMinor: booking.amountMinor,
        currency: booking.currency,
        phone: booking.phone,
        idempotencyKey: booking.id,
    })
    const paymentUrl = publicMediaUrl(payment.url)
    if (!paymentUrl || !payment.reference) throw new Error('Payment provider returned an invalid payment link')
    return getWabaPrisma().whatsAppBooking.update({
        where: { id: booking.id },
        data: { paymentReference: payment.reference, paymentUrl },
    })
}
export async function confirmBooking(bookingId: string, receipt?: PaymentReceipt) {
    const prisma = getWabaPrisma()
    return prisma.$transaction(async (tx: any) => {
        // Serialize repeat payment notifications and expiry for this booking.
        await tx.$queryRawUnsafe('SELECT id FROM "WhatsAppBooking" WHERE id = $1 FOR UPDATE', bookingId)
        const row = await tx.whatsAppBooking.findUnique({ where: { id: bookingId } })
        if (!row) throw new Error('Booking not found')
        if (row.mode !== 'LIVE') throw new Error('Test bookings cannot be confirmed as real bookings')
        if (
            row.amountMinor > 0 &&
            (!receipt?.captured ||
                !receipt.paymentId ||
                receipt.bookingId !== row.id ||
                receipt.paymentReference !== row.paymentReference ||
                receipt.amountMinor !== row.amountMinor ||
                receipt.currency.toUpperCase() !== row.currency)
        )
            throw new Error('Verified captured payment does not match the booking')
        if (row.status === 'CONFIRMED') {
            if (receipt && row.paymentId !== receipt.paymentId)
                throw new Error('Booking already paid with a different payment')
            await tx.whatsAppAssistantJob.upsert({
                where: { key: `booking:${row.id}` },
                create: {
                    key: `booking:${row.id}`,
                    kind: 'BOOKING_CONFIRMED',
                    accountId: row.accountId,
                    phone: row.phone,
                    payload: { bookingId: row.id },
                },
                update: {},
            })
            return row
        }
        if (row.status !== 'HELD' || +row.expiresAt <= Date.now())
            throw new Error('Booking hold expired; payment needs manual review/refund')
        const claim = await tx.whatsAppBookingSlot.updateMany({
            where: { id: row.slotId, bookingId: row.id, reservedUntil: { gt: new Date() } },
            data: { reservedUntil: null },
        })
        if (!claim.count) throw new Error('Booking hold expired; contact the team')
        const confirmed = await tx.whatsAppBooking.update({
            where: { id: row.id },
            data: { status: 'CONFIRMED', paymentId: receipt?.paymentId || null },
        })
        await tx.whatsAppAssistantJob.upsert({
            where: { key: `booking:${row.id}` },
            create: {
                key: `booking:${row.id}`,
                kind: 'BOOKING_CONFIRMED',
                accountId: row.accountId,
                phone: row.phone,
                payload: { bookingId: row.id },
            },
            update: {},
        })
        return confirmed
    })
}
export async function expireBookingHolds() {
    const prisma = getWabaPrisma()
    await prisma.whatsAppBooking.updateMany({
        where: { status: 'HELD', expiresAt: { lt: new Date() } },
        data: { status: 'EXPIRED' },
    })
    await prisma.whatsAppBookingSlot.updateMany({
        where: { reservedUntil: { lt: new Date() } },
        data: { bookingId: null, reservedUntil: null },
    })
    const expired = await prisma.whatsAppBooking.findMany({
        where: {
            status: 'EXPIRED',
            mode: 'LIVE',
            paymentCancellationQueued: false,
            paymentReference: { not: null },
        },
        take: 100,
        orderBy: { createdAt: 'desc' },
    })
    for (const booking of expired) {
        await enqueueAssistantJob(
            `cancel-payment:${booking.id}`,
            'CANCEL_PAYMENT',
            { bookingId: booking.id },
            booking.accountId,
            booking.phone,
        )
        await prisma.whatsAppBooking.update({
            where: { id: booking.id },
            data: { paymentCancellationQueued: true },
        })
    }
}
export async function scheduleBookingReminders() {
    const prisma = getWabaPrisma()
    const bookings = await prisma.whatsAppBooking.findMany({
        where: {
            status: 'CONFIRMED',
            reminderQueued: false,
            startsAt: { gt: new Date(), lte: new Date(Date.now() + 3600000) },
        },
        take: 100,
    })
    for (const booking of bookings) {
        const settings = await getAssistantSettings(booking.accountId)
        if (!settings.reminderTemplate) continue
        // Reminders always use an approved template, even outside the service window.
        await enqueueAssistantJob(
            `reminder:${booking.id}`,
            'REMINDER',
            { bookingId: booking.id, templateName: settings.reminderTemplate },
            booking.accountId,
            booking.phone,
        )
        await prisma.whatsAppBooking.update({ where: { id: booking.id }, data: { reminderQueued: true } })
    }
}
