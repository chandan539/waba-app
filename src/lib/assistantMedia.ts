import crypto from 'crypto'
import sharp from 'sharp'
import QRCode from 'qrcode'
import { resolveWabaWebhookUrl } from './config'
import { formatSlot } from './assistantCore'

export function signedBookingMediaUrl(bookingId: string, kind: 'ticket' | 'payment') {
    const secret = process.env.WABA_MEDIA_SIGNING_SECRET
    if (!secret) return ''
    const expires = Math.floor(Date.now() / 1000) + 86400
    const signature = crypto.createHmac('sha256', secret).update(`${kind}:${bookingId}:${expires}`).digest('hex')
    return `${resolveWabaWebhookUrl()}/media/${kind}/${encodeURIComponent(bookingId)}?expires=${expires}&signature=${signature}`
}
export function verifyBookingMedia(bookingId: string, kind: string, expires: string, signature: string) {
    const secret = process.env.WABA_MEDIA_SIGNING_SECRET
    if (
        !secret ||
        !['ticket', 'payment'].includes(kind) ||
        !/^\d+$/.test(expires) ||
        Number(expires) < Date.now() / 1000 ||
        Number(expires) > Date.now() / 1000 + 86500 ||
        !/^[a-f0-9]{64}$/.test(signature)
    )
        return false
    const expected = crypto.createHmac('sha256', secret).update(`${kind}:${bookingId}:${expires}`).digest()
    return crypto.timingSafeEqual(expected, Buffer.from(signature, 'hex'))
}
function xml(text: unknown) {
    return String(text).replace(
        /[&<>"']/g,
        (value) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[value]!,
    )
}
export async function renderBookingMedia(
    booking: any,
    businessName: string,
    timezone: string,
    kind: 'ticket' | 'payment',
) {
    const demo = booking.mode === 'TEST'
    if (kind === 'payment') {
        if (!booking.paymentUrl || demo || booking.status !== 'HELD' || +booking.expiresAt < Date.now())
            throw new Error('Payment link is unavailable')
        // QR encodes the provider-hosted payment URL, never a self-asserted payment confirmation.
        return QRCode.toBuffer(booking.paymentUrl, { width: 640, margin: 3 })
    }
    if (!demo && booking.status !== 'CONFIRMED') throw new Error('Booking is not confirmed')
    const svg = `<svg width="1000" height="560" xmlns="http://www.w3.org/2000/svg"><rect width="1000" height="560" rx="28" fill="#f2f4f7"/><rect width="1000" height="150" fill="#00685d"/><g font-family="sans-serif"><text x="50" y="65" font-size="28" fill="white">${xml(businessName.slice(0, 50))}</text><text x="50" y="115" font-size="23" fill="#c9fff0">${demo ? 'DEMO TICKET — NOT A REAL BOOKING' : 'BOOKING CONFIRMED'}</text><text x="50" y="220" font-size="34" fill="#172b4d">${xml(booking.sessionName.slice(0, 45))}</text><text x="50" y="290" font-size="27" fill="#172b4d">${xml(formatSlot(booking.startsAt, timezone))}</text><text x="50" y="335" font-size="22" fill="#64748b">${xml(timezone)}</text><text x="50" y="425" font-size="20" fill="#64748b">Ticket ${xml(booking.id)}</text><text x="50" y="490" font-size="20" fill="#00685d">${demo ? 'No payment collected. No calendar event created.' : 'Keep this ticket for your appointment.'}</text></g></svg>`
    return sharp(Buffer.from(svg)).png().toBuffer()
}
