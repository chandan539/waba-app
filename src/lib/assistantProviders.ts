/** Optional server-side providers. Set credentials in the host secret store, never in browser settings. */
import crypto from 'crypto'
import { getWabaPrisma } from './adapters'
import type { AssistantAdapters } from './assistantTypes'

async function jsonRequest(url: string, init: RequestInit = {}) {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) })
    const data: any = await response.json()
    if (!response.ok) throw new Error(`Provider request failed (${response.status})`)
    return data
}
export function razorpayAssistantAdapters(input: {
    keyId: string
    keySecret: string
    webhookSecret: string
}): AssistantAdapters {
    if (!input.keyId || !input.keySecret || !input.webhookSecret)
        throw new Error('Razorpay key ID, key secret and webhook secret are required')
    const headers = {
        authorization: `Basic ${Buffer.from(`${input.keyId}:${input.keySecret}`).toString('base64')}`,
        'content-type': 'application/json',
    }
    const request = (path: string, init: RequestInit = {}) =>
        jsonRequest(`https://api.razorpay.com/v1/${path}`, { ...init, headers })
    return {
        async createPayment({ bookingId, amountMinor, currency, phone }) {
            const booking = await getWabaPrisma().whatsAppBooking.findUnique({ where: { id: bookingId } })
            if (!booking || booking.mode !== 'LIVE' || +booking.expiresAt <= Date.now())
                throw new Error('Live booking hold required')
            const reference = `waba_${bookingId.replace(/-/g, '')}`
            // reference_id is unique in Razorpay; recover a prior create after a process restart.
            const existing = await request(`payment_links?reference_id=${encodeURIComponent(reference)}`)
            let link = (existing.payment_links || []).find((item: any) => item.reference_id === reference)
            if (!link)
                link = await request('payment_links', {
                    method: 'POST',
                    body: JSON.stringify({
                        amount: amountMinor,
                        currency,
                        accept_partial: false,
                        reference_id: reference,
                        description: `Booking ${bookingId}`,
                        expire_by: Math.floor(Math.max(+booking.expiresAt, Date.now() + 16 * 60000) / 1000),
                        customer: { contact: `+${phone}` },
                        notify: { sms: false, email: false },
                        reminder_enable: false,
                        notes: { bookingId },
                    }),
                })
            if (
                link.amount !== amountMinor ||
                link.currency !== currency ||
                link.status === 'cancelled' ||
                link.status === 'expired'
            )
                throw new Error('Payment link does not match this booking')
            return { reference: link.id, url: link.short_url }
        },
        async cancelPayment(booking) {
            if (!booking.paymentReference) return
            const link = await request(`payment_links/${encodeURIComponent(booking.paymentReference)}`)
            if (link.status === 'created' || link.status === 'partially_paid')
                await request(`payment_links/${encodeURIComponent(link.id)}/cancel`, { method: 'POST' })
        },
        async verifyPaymentWebhook({ provider, rawBody, headers: incoming }) {
            if (provider !== 'razorpay') return null
            const signature = String(incoming['x-razorpay-signature'] || '')
            const expected = crypto.createHmac('sha256', input.webhookSecret).update(rawBody).digest()
            if (
                !/^[a-f0-9]{64}$/i.test(signature) ||
                !crypto.timingSafeEqual(expected, Buffer.from(signature, 'hex'))
            )
                return null
            const event = JSON.parse(rawBody.toString('utf8'))
            if (event.event !== 'payment_link.paid')
                return {
                    bookingId: '',
                    paymentId: '',
                    paymentReference: '',
                    amountMinor: 0,
                    currency: 'INR',
                    captured: false,
                }
            const paymentId = event.payload?.payment?.entity?.id
            const linkId = event.payload?.payment_link?.entity?.id
            if (!paymentId || !linkId) return null
            const [payment, link] = await Promise.all([
                request(`payments/${encodeURIComponent(paymentId)}`),
                request(`payment_links/${encodeURIComponent(linkId)}`),
            ])
            const bookingId = link.notes?.bookingId
            if (
                !bookingId ||
                payment.status !== 'captured' ||
                !payment.captured ||
                link.status !== 'paid' ||
                link.amount_paid !== link.amount ||
                !(link.payments || []).some((item: any) => item.payment_id === payment.id)
            )
                return null
            return {
                bookingId,
                paymentId: payment.id,
                paymentReference: link.id,
                amountMinor: payment.amount,
                currency: payment.currency,
                captured: true,
            }
        },
    }
}
export function googleCalendarAssistantAdapters(input: {
    calendarId: string
    clientId: string
    clientSecret: string
    refreshToken: string
    createMeet?: boolean
}): AssistantAdapters {
    if (!input.calendarId || !input.clientId || !input.clientSecret || !input.refreshToken)
        throw new Error('Google Calendar ID and OAuth refresh credentials are required')
    let token = '',
        expiresAt = 0
    const accessToken = async () => {
        if (token && expiresAt > Date.now() + 60000) return token
        const data = await jsonRequest('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                client_id: input.clientId,
                client_secret: input.clientSecret,
                refresh_token: input.refreshToken,
            }),
        })
        token = data.access_token
        expiresAt = Date.now() + data.expires_in * 1000
        return token
    }
    const request = async (path: string, init: RequestInit = {}) =>
        jsonRequest(`https://www.googleapis.com/calendar/v3/${path}`, {
            ...init,
            headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
        })
    const available = async (slot: { startsAt: Date; endsAt: Date }) => {
        const data = await request('freeBusy', {
            method: 'POST',
            body: JSON.stringify({
                timeMin: new Date(slot.startsAt).toISOString(),
                timeMax: new Date(slot.endsAt).toISOString(),
                items: [{ id: input.calendarId }],
            }),
        })
        const calendar = data.calendars?.[input.calendarId]
        if (!calendar || calendar.errors?.length) throw new Error('Calendar availability could not be checked')
        return Array.isArray(calendar.busy) && !calendar.busy.length
    }
    return {
        validateSlot: available,
        async confirmBooking(booking, idempotencyKey) {
            // Hex IDs satisfy Google’s base32hex character restrictions and make retries idempotent.
            const id = crypto.createHash('sha256').update(idempotencyKey).digest('hex')
            const path = `calendars/${encodeURIComponent(input.calendarId)}/events`
            const headers = { authorization: `Bearer ${await accessToken()}` }
            const existing = await fetch(`https://www.googleapis.com/calendar/v3/${path}/${id}`, {
                headers,
                signal: AbortSignal.timeout(15000),
            })
            if (existing.ok) {
                const event: any = await existing.json()
                return { externalId: event.id, meetingUrl: event.hangoutLink || '' }
            }
            if (existing.status !== 404) throw new Error(`Calendar lookup failed (${existing.status})`)
            if (!(await available(booking)))
                throw new Error('Calendar conflict after payment; staff must reschedule or refund')
            const event = await request(`${path}?conferenceDataVersion=1`, {
                method: 'POST',
                body: JSON.stringify({
                    id,
                    summary: booking.sessionName,
                    description: `WhatsApp booking ${booking.id}. Customer: ${booking.phone}`,
                    start: { dateTime: new Date(booking.startsAt).toISOString() },
                    end: { dateTime: new Date(booking.endsAt).toISOString() },
                    ...(input.createMeet
                        ? {
                              conferenceData: {
                                  createRequest: {
                                      requestId: id,
                                      conferenceSolutionKey: { type: 'hangoutsMeet' },
                                  },
                              },
                          }
                        : {}),
                }),
            })
            return { externalId: event.id, meetingUrl: event.hangoutLink || '' }
        },
    }
}
