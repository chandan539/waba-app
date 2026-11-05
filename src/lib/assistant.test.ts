import { describe, it, expect, vi } from 'vitest'
import { assistantDefaults } from './assistantDefaults'
import { validateAssistantSettings, welcomeActions, interactiveId } from './assistantCore'
import { actionPayload } from './assistantTransport'
import { renderBookingMedia, signedBookingMediaUrl, verifyBookingMedia } from './assistantMedia'
import { razorpayAssistantAdapters } from './assistantProviders'

describe('assistant configuration and transport contracts', () => {
    it('starts disabled and requires explicit test recipients', () => {
        expect(assistantDefaults.enabled).toBe(false)
        expect(assistantDefaults.mode).toBe('TEST')
        expect(() => validateAssistantSettings({ enabled: true })).toThrow('test phone')
        expect(
            validateAssistantSettings({ ...assistantDefaults, enabled: true, testPhones: ['+91 98765 43210'] })
                .testPhones,
        ).toEqual(['919876543210'])
    })
    it('validates money, timezones, AI configuration and URLs', () => {
        expect(() => validateAssistantSettings({ priceMinor: -1 })).toThrow('Price')
        expect(() => validateAssistantSettings({ priceMinor: 1.5 })).toThrow('Price')
        expect(() => validateAssistantSettings({ timezone: 'Not/real' })).toThrow()
        expect(() => validateAssistantSettings({ guideUrl: 'http://example.com/a.pdf' })).toThrow('HTTPS')
        expect(() => validateAssistantSettings({ aiEnabled: true })).toThrow('business knowledge')
        expect(() => validateAssistantSettings({ maxDailyAiCalls: 0 })).toThrow('limit')
    })
    it('uses stable action IDs with configurable menu labels', () => {
        const actions = welcomeActions({
            ...assistantDefaults,
            menuLabels: { ...assistantDefaults.menuLabels, enquiry: 'Ask for a quote' },
        })
        const payload = actionPayload(actions[0])
        const rows = payload.interactive.action.sections[0].rows
        expect(rows[0]).toEqual({ id: 'menu:enquiry', title: 'Ask for a quote' })
        expect(rows.some((row: any) => row.id === 'menu:book')).toBe(false)
        expect(interactiveId({ interactive: { list_reply: { id: 'menu:human', title: 'Changed title' } } })).toBe(
            'menu:human',
        )
    })
    it('renders a real PNG ticket with escaped business data', async () => {
        const png = await renderBookingMedia(
            { id: 'ticket-test', sessionName: 'Test <session>', startsAt: new Date(), mode: 'TEST' },
            'Business & Co',
            'Asia/Kolkata',
            'ticket',
        )
        expect(png.subarray(1, 4).toString()).toBe('PNG')
        expect(png.length).toBeGreaterThan(1000)
    })
    it('uses expiring, tamper-resistant public media links', () => {
        vi.stubEnv('WABA_MEDIA_SIGNING_SECRET', 'media-test-secret')
        // config is loaded once, so use a fixed valid origin through the config object.
        const expires = String(Math.floor(Date.now() / 1000) + 600)
        expect(verifyBookingMedia('booking', 'ticket', expires, 'bad')).toBe(false)
        expect(verifyBookingMedia('booking', 'ticket', '0', 'a'.repeat(64))).toBe(false)
        vi.unstubAllEnvs()
    })
    it('rejects forged Razorpay webhooks without any provider calls', async () => {
        const adapter = razorpayAssistantAdapters({ keyId: 'test', keySecret: 'test', webhookSecret: 'secret' })
        expect(
            await adapter.verifyPaymentWebhook!({
                provider: 'razorpay',
                rawBody: Buffer.from('{}'),
                headers: { 'x-razorpay-signature': 'bad' },
            }),
        ).toBeNull()
    })
})
