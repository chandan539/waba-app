import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import crypto from 'crypto'
import { setWabaAdapters } from './adapters'
import { assistantDefaults } from './assistantDefaults'
import { saveAssistantSettings } from './assistantStore'
import { processAssistantJobs } from './assistantWorker'
import { confirmBooking, holdBooking, expireBookingHolds, preparePayment } from './assistantBookings'
import { disconnectWaba, recordWabaMessage, saveConnectedWaba } from './wabaService'
import analyticsRouter from '../routes/wabaAnalytics'
import { mountWaba } from './mountWaba'
import adminRouter from '../routes/wabaAssistant'

const databaseUrl = process.env.TEST_DATABASE_URL
let prisma: any, app: any
const phone = '919876543210',
    accountId = 'assistant-test-account',
    secret = 'test-meta-secret'
const settings = { ...assistantDefaults, enabled: true, testPhones: [phone], bookingEnabled: true }
let fetchMock: any
function payload(text: string, id = crypto.randomUUID(), tap?: string) {
    return {
        object: 'whatsapp_business_account',
        entry: [
            {
                id: 'test-waba',
                changes: [
                    {
                        field: 'messages',
                        value: {
                            metadata: { phone_number_id: 'test-phone-id' },
                            contacts: [{ wa_id: phone, profile: { name: 'Test customer' } }],
                            messages: [
                                {
                                    id,
                                    from: phone,
                                    timestamp: String(Math.floor(Date.now() / 1000)),
                                    type: tap ? 'interactive' : 'text',
                                    ...(tap
                                        ? { interactive: { list_reply: { id: tap, title: text } } }
                                        : { text: { body: text } }),
                                },
                            ],
                        },
                    },
                ],
            },
        ],
    }
}
async function inbound(text: string, id = crypto.randomUUID(), tap?: string) {
    const body = JSON.stringify(payload(text, id, tap))
    return request(app)
        .post('/webhook')
        .set('content-type', 'application/json')
        .set('x-hub-signature-256', `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`)
        .send(body)
}
async function drain(times = 4) {
    for (let i = 0; i < times; i++) await processAssistantJobs(100)
}
async function createSlot(offset = 3600000) {
    return prisma.whatsAppBookingSlot.create({
        data: {
            accountId,
            startsAt: new Date(Date.now() + offset),
            endsAt: new Date(Date.now() + offset + 1800000),
        },
    })
}
describe.skipIf(!databaseUrl)('assistant with real Postgres and mocked external providers', () => {
    beforeAll(async () => {
        if (!/^waba_test/.test(new URL(databaseUrl!).pathname.slice(1)))
            throw new Error('Integration tests require a disposable waba_test database')
        const { PrismaClient } = await import('@prisma/client')
        prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
        app = express()
        mountWaba(app, {
            prisma,
            requireAdmin: (_req, _res, next) => next(),
            adminPath: '/waba',
            webhookPath: '/webhook',
            workers: false,
        })
        app.use('/assistant', express.json(), adminRouter)
        app.use('/analytics', analyticsRouter)
    })
    beforeEach(async () => {
        for (const model of [
            'whatsAppAssistantDelivery',
            'whatsAppAssistantJob',
            'whatsAppAiUsage',
            'whatsAppBooking',
            'whatsAppBookingSlot',
            'whatsAppLead',
            'whatsAppAssistantSession',
            'whatsAppAssistantConfig',
            'whatsAppContact',
            'whatsAppMessage',
            'whatsAppAccount',
        ])
            await prisma[model].deleteMany()
        setWabaAdapters({ prisma, requireAdmin: (_req, _res, next) => next() })
        await prisma.whatsAppAccount.create({
            data: {
                id: accountId,
                wabaId: 'test-waba',
                phoneNumberId: 'test-phone-id',
                accessToken: 'fake',
                metaAppSecret: secret,
                isSelected: true,
                connectedAt: new Date(),
            },
        })
        await saveAssistantSettings(accountId, settings)
        fetchMock = vi.fn(
            async () =>
                new Response(JSON.stringify({ messages: [{ id: crypto.randomUUID() }] }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                }),
        )
        vi.stubGlobal('fetch', fetchMock)
    })
    afterAll(async () => {
        vi.unstubAllGlobals()
        await prisma?.$disconnect()
    })
    it('fails closed when admin auth is not wired', async () => {
        setWabaAdapters({ prisma })
        expect((await request(app).get('/assistant')).status).toBe(503)
    })
    it('rejects unsigned, forged and cross-account webhooks before persistence', async () => {
        expect((await request(app).post('/webhook').send(payload('hi'))).status).toBe(403)
        expect(
            (await request(app).post('/webhook').set('x-hub-signature-256', 'sha256=bad').send(payload('hi')))
                .status,
        ).toBe(403)
        const body = JSON.stringify({ ...payload('hi'), entry: [{ ...payload('hi').entry[0], id: 'other-waba' }] })
        expect(
            (
                await request(app)
                    .post('/webhook')
                    .set('content-type', 'application/json')
                    .set(
                        'x-hub-signature-256',
                        `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`,
                    )
                    .send(body)
            ).status,
        ).toBe(403)
        expect(await prisma.whatsAppAssistantJob.count()).toBe(0)
    })
    it('acknowledges before processing, then sends a welcome menu only once on replay', async () => {
        const id = crypto.randomUUID()
        expect((await inbound('hi', id)).status).toBe(200)
        expect(fetchMock).not.toHaveBeenCalled()
        await drain()
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(JSON.parse(fetchMock.mock.calls[0][1].body).interactive.action.sections[0].rows).toHaveLength(6)
        await inbound('hi', id)
        await drain()
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(await prisma.whatsAppMessage.count({ where: { direction: 'INBOUND' } })).toBe(1)
    })
    it('keeps automation off for non-allowlisted test phones', async () => {
        await saveAssistantSettings(accountId, { ...settings, testPhones: ['919111111111'] })
        await inbound('hi')
        await drain()
        expect(fetchMock).not.toHaveBeenCalled()
    })
    it('captures a waitlist email, validates it, and retains it through retries', async () => {
        await inbound('Join', undefined, 'menu:waitlist')
        await drain()
        await inbound('invalid')
        await drain()
        expect(await prisma.whatsAppLead.count()).toBe(0)
        await inbound('customer@example.com')
        await drain()
        const leads = await prisma.whatsAppLead.findMany()
        expect(leads).toHaveLength(1)
        expect(leads[0].details.text).toBe('customer@example.com')
        expect((await prisma.whatsAppAssistantSession.findFirst()).state).toEqual({})
    })
    it('pauses the assistant on human request and resumes only through the admin API', async () => {
        await inbound('human')
        await drain()
        expect((await prisma.whatsAppAssistantSession.findFirst()).handover).toBe(true)
        const sends = fetchMock.mock.calls.length
        await inbound('hi')
        await drain()
        expect(fetchMock).toHaveBeenCalledTimes(sends)
        expect(
            (await request(app).post('/assistant/handover').send({ accountId, phone, handover: false })).status,
        ).toBe(200)
        await inbound('hi')
        await drain()
        expect(fetchMock).toHaveBeenCalledTimes(sends + 1)
    })
    it('does not reply to opted-out customers', async () => {
        await inbound('STOP')
        await drain()
        await inbound('hi')
        await drain()
        expect(fetchMock).not.toHaveBeenCalled()
        expect((await prisma.whatsAppContact.findFirst()).optedOut).toBe(true)
    })
    it('allows only one customer to claim a slot concurrently', async () => {
        const slot = await createSlot()
        const results = await Promise.allSettled([
            holdBooking(accountId, phone, slot.id, 'claim-1', settings),
            holdBooking(accountId, '919111111111', slot.id, 'claim-2', settings),
        ])
        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
        expect(await prisma.whatsAppBooking.count()).toBe(1)
    })
    it('expires holds and makes the slot available again', async () => {
        const slot = await createSlot()
        const booking = await holdBooking(accountId, phone, slot.id, 'expiry', settings)
        await prisma.whatsAppBooking.update({
            where: { id: booking.id },
            data: { expiresAt: new Date(Date.now() - 1000) },
        })
        await prisma.whatsAppBookingSlot.update({
            where: { id: slot.id },
            data: { reservedUntil: new Date(Date.now() - 1000) },
        })
        await expireBookingHolds()
        expect((await prisma.whatsAppBooking.findUnique({ where: { id: booking.id } })).status).toBe('EXPIRED')
        expect((await prisma.whatsAppBookingSlot.findUnique({ where: { id: slot.id } })).bookingId).toBeNull()
    })
    it('never confirms a test booking as a live booking', async () => {
        const slot = await createSlot()
        const booking = await holdBooking(accountId, phone, slot.id, 'test-confirm', settings)
        await expect(confirmBooking(booking.id)).rejects.toThrow('Test bookings')
    })
    it('requires captured payment with matching amount, currency and provider reference', async () => {
        setWabaAdapters({
            prisma,
            requireAdmin: (_req, _res, next) => next(),
            assistant: { createPayment: async () => ({ reference: 'plink_1', url: 'https://example.com/pay' }) },
        })
        const slot = await createSlot()
        let booking = await holdBooking(accountId, phone, slot.id, 'live-paid', {
            ...settings,
            mode: 'LIVE',
            priceMinor: 10000,
        })
        booking = await preparePayment(booking)
        const receipt = {
            bookingId: booking.id,
            paymentId: 'pay_1',
            paymentReference: 'plink_1',
            amountMinor: 10000,
            currency: 'INR',
            captured: true,
        }
        await expect(confirmBooking(booking.id)).rejects.toThrow('Verified captured payment')
        await expect(confirmBooking(booking.id, { ...receipt, amountMinor: 1 })).rejects.toThrow('does not match')
        await expect(confirmBooking(booking.id, { ...receipt, captured: false })).rejects.toThrow('does not match')
        const confirmations = await Promise.all([
            confirmBooking(booking.id, receipt),
            confirmBooking(booking.id, receipt),
        ])
        expect(confirmations.map((result) => result.status)).toEqual(['CONFIRMED', 'CONFIRMED'])
        expect(await prisma.whatsAppAssistantJob.count({ where: { kind: 'BOOKING_CONFIRMED' } })).toBe(1)
    })
    it('does not treat a customer payment claim as confirmation', async () => {
        await inbound('I have paid')
        await drain()
        expect(await prisma.whatsAppBooking.count({ where: { status: 'CONFIRMED' } })).toBe(0)
        expect(JSON.parse(fetchMock.mock.calls[0][1].body).text.body).toContain('only after verification')
    })
    it('blocks duplicate sends after an ambiguous network failure', async () => {
        fetchMock.mockRejectedValue(new Error('network timeout'))
        await inbound('hi')
        await drain()
        await prisma.whatsAppAssistantJob.updateMany({
            where: { kind: 'INBOUND' },
            data: { availableAt: new Date(0) },
        })
        await drain()
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect((await prisma.whatsAppAssistantDelivery.findFirst()).status).toBe('REVIEW')
    })
    it('rejects invalid settings and an unknown account without falling back to another account', async () => {
        expect(
            (
                await request(app)
                    .put('/assistant/settings')
                    .send({ accountId, settings: { ...settings, timezone: 'invalid/timezone' } })
            ).status,
        ).toBe(400)
        expect((await request(app).get('/assistant').query({ accountId: 'unknown' })).status).toBe(400)
    })
    it('applies the service window to delayed replies', async () => {
        await recordWabaMessage({
            accountId,
            phone,
            direction: 'INBOUND',
            body: 'old',
            createdAt: new Date(Date.now() - 25 * 3600000),
        })
        const { deliverAssistantAction } = await import('./assistantTransport')
        await deliverAssistantAction('old-message', accountId, phone, { type: 'text', text: 'Do not send' })
        expect(fetchMock).not.toHaveBeenCalled()
    })
    it('routes Hinglish booking intent to actual available slots rather than invented availability', async () => {
        vi.stubEnv('ANTHROPIC_API_KEY', 'test-only-key')
        await saveAssistantSettings(accountId, {
            ...settings,
            aiEnabled: true,
            model: 'test-model',
            knowledge: 'We offer business consultations.',
        })
        const slot = await createSlot()
        fetchMock.mockImplementation(
            async (url: string) =>
                new Response(
                    JSON.stringify(
                        url.includes('anthropic')
                            ? {
                                  content: [
                                      {
                                          type: 'text',
                                          text: JSON.stringify({ intent: 'book', text: 'Booking request' }),
                                      },
                                  ],
                              }
                            : { messages: [{ id: crypto.randomUUID() }] },
                    ),
                    { status: 200 },
                ),
        )
        await inbound('kal shaam call ho sakti hai?')
        await drain()
        const send = fetchMock.mock.calls.find((call: any[]) => String(call[0]).includes('graph.facebook'))
        const rows = JSON.parse(send[1].body).interactive.action.sections[0].rows
        expect(rows[0].id).toBe(`slot:${slot.id}`)
        expect((await prisma.whatsAppAiUsage.findFirst()).calls).toBe(1)
        vi.unstubAllEnvs()
    })
    it('enforces the AI daily request budget and hands over on exhaustion', async () => {
        vi.stubEnv('ANTHROPIC_API_KEY', 'test-only-key')
        await saveAssistantSettings(accountId, {
            ...settings,
            aiEnabled: true,
            model: 'test-model',
            knowledge: 'Consultations cost INR 100.',
            maxDailyAiCalls: 1,
        })
        fetchMock.mockImplementation(
            async (url: string) =>
                new Response(
                    JSON.stringify(
                        url.includes('anthropic')
                            ? {
                                  content: [
                                      {
                                          type: 'text',
                                          text: '{"intent":"answer","text":"Consultations cost INR 100."}',
                                      },
                                  ],
                              }
                            : { messages: [{ id: crypto.randomUUID() }] },
                    ),
                    { status: 200 },
                ),
        )
        await inbound('What is the price?')
        await drain()
        await inbound('Please explain more')
        await drain()
        expect(fetchMock.mock.calls.filter((call: any[]) => String(call[0]).includes('anthropic'))).toHaveLength(1)
        expect((await prisma.whatsAppAssistantSession.findFirst()).handover).toBe(true)
        vi.unstubAllEnvs()
    })
    it('prevents overlapping slots, including simultaneous admin requests', async () => {
        const startsAt = new Date(Date.now() + 3600000).toISOString(),
            endsAt = new Date(Date.now() + 7200000).toISOString()
        const responses = await Promise.all([
            request(app).post('/assistant/slots').send({ accountId, startsAt, endsAt }),
            request(app)
                .post('/assistant/slots')
                .send({ accountId, startsAt: new Date(Date.now() + 3700000).toISOString(), endsAt }),
        ])
        expect(responses.map((response) => response.status).sort()).toEqual([200, 400])
        expect(await prisma.whatsAppBookingSlot.count()).toBe(1)
    })

    it('uses the selected session price instead of the default session price', async () => {
        const slot = await createSlot()
        await prisma.whatsAppBookingSlot.update({ where: { id: slot.id }, data: { serviceId: 'strategy' } })
        const booking = await holdBooking(accountId, phone, slot.id, 'strategy-booking', {
            ...settings,
            bookingServices: [{ id: 'strategy', name: 'Strategy session', priceMinor: 25000 }],
        })
        expect(booking.sessionName).toBe('Strategy session')
        expect(booking.amountMinor).toBe(25000)
    })
    it('queues cancellation of an expired provider payment link', async () => {
        const slot = await createSlot()
        const booking = await holdBooking(accountId, phone, slot.id, 'cancel-provider', settings)
        await prisma.whatsAppBooking.update({
            where: { id: booking.id },
            data: { mode: 'LIVE', paymentReference: 'plink_expired', expiresAt: new Date(Date.now() - 1000) },
        })
        const cancelPayment = vi.fn(async () => {})
        setWabaAdapters({ prisma, requireAdmin: (_req, _res, next) => next(), assistant: { cancelPayment } })
        await expireBookingHolds()
        await drain()
        expect(cancelPayment).toHaveBeenCalledTimes(1)
        expect(
            (await prisma.whatsAppBooking.findUnique({ where: { id: booking.id } })).paymentCancellationQueued,
        ).toBe(true)
    })
    it('connects two numbers under one WABA and preserves the shared webhook subscription', async () => {
        vi.stubEnv('WABA_WEBHOOK_URL', 'https://example.test/webhook')
        const { wabaConfig } = await import('./config')
        const original = wabaConfig.webhookUrl
        wabaConfig.webhookUrl = 'https://example.test/webhook'
        try {
            fetchMock.mockImplementation(async () => new Response(JSON.stringify({
                status: 'CONNECTED', platform_type: 'CLOUD_API', verified_name: 'Second number',
            })))
            await saveConnectedWaba({ accessToken: 'test-token', wabaId: 'test-waba', phoneNumberId: 'second-phone-id' })
            const rows = await prisma.whatsAppAccount.findMany({ where: { wabaId: 'test-waba' } })
            expect(rows.map((row: any) => row.phoneNumberId)).toEqual(expect.arrayContaining(['test-phone-id', 'second-phone-id']))
            const second = rows.find((row: any) => row.phoneNumberId === 'second-phone-id')
            await disconnectWaba(second.id)
            expect(fetchMock.mock.calls.some(([, init]: any[]) => init?.method === 'DELETE')).toBe(false)
            expect((await prisma.whatsAppAccount.findUnique({ where: { id: accountId } })).phoneNumberId).toBe('test-phone-id')
        } finally {
            wabaConfig.webhookUrl = original
            vi.unstubAllEnvs()
        }
    })

    it('reports message counts for the selected number and counts reads as delivered', async () => {
        await recordWabaMessage({ accountId, phone, direction: 'INBOUND', body: 'hi' })
        await recordWabaMessage({ accountId, phone, direction: 'OUTBOUND', body: 'hello', status: 'read' })
        const response = await request(app).get('/analytics').query({ accountId, days: 7 })
        expect(response.status).toBe(200)
        expect(response.body.daily).toHaveLength(7)
        expect(response.body.daily.at(-1)).toMatchObject({ inbound: 1, outbound: 1, delivered: 1, read: 1 })
    })

    it('keeps the same customer separated by business number and renders shared contacts', async () => {
        const other = await prisma.whatsAppAccount.create({ data: {
            wabaId: 'test-waba', phoneNumberId: 'other-number', accessToken: 'other-token',
        } })
        await recordWabaMessage({ accountId, phone, direction: 'INBOUND', body: 'Main line' })
        await recordWabaMessage({
            accountId: other.id, phone, direction: 'INBOUND', type: 'contacts', body: '[contacts]',
            raw: { contacts: [{ name: { formatted_name: 'Jordan Lee' }, phones: [{ phone: '+1 202-555-0190' }] }] },
        })
        const combined = await request(app).get('/waba/inbox').query({ scope: 'all' }).expect(200)
        expect(combined.body.conversations.map((row: any) => row.accountId)).toEqual(expect.arrayContaining([accountId, other.id]))
        const filtered = await request(app).get('/waba/inbox').query({ accountId: other.id }).expect(200)
        expect(filtered.body.conversations).toHaveLength(1)
        const thread = await request(app).get(`/waba/inbox/${phone}`).query({ accountId: other.id }).expect(200)
        expect(thread.body.messages).toHaveLength(1)
        expect(thread.body.messages[0]).not.toHaveProperty('raw')
        expect(thread.body.messages[0].sharedContacts).toEqual([expect.objectContaining({
            name: 'Jordan Lee', phones: ['+1 202-555-0190'],
        })])
        await request(app).post('/waba/inbox/reply').send({ accountId: other.id, phone, text: 'On this line' }).expect(200)
        expect(fetchMock.mock.calls.at(-1)[0]).toContain('/other-number/messages')
    })

    it('streams a PDF using the owning number credentials and rejects expired or cross-number downloads', async () => {
        const media = { id: '12345', mime_type: 'application/pdf', filename: 'brief.pdf' }
        const recent = await recordWabaMessage({
            accountId, phone, direction: 'INBOUND', type: 'document', body: 'brief.pdf', raw: { document: media },
        })
        const expired = await recordWabaMessage({
            accountId, phone, direction: 'INBOUND', type: 'document', body: 'old.pdf', raw: { document: media },
            createdAt: new Date(Date.now() - 25 * 3600000),
        })
        await request(app).get(`/waba/inbox/attachments/${recent.id}`).query({ accountId: 'other' }).expect(404)
        await request(app).get(`/waba/inbox/attachments/${expired.id}`).query({ accountId }).expect(410)
        expect(fetchMock).not.toHaveBeenCalled()
        fetchMock.mockImplementation(async (url: string | URL) => String(url).includes('graph.facebook.com')
            ? new Response(JSON.stringify({ url: 'https://lookaside.fbsbx.com/attachment', file_size: 9 }))
            : new Response('%PDF-1.4\n'))
        const response = await request(app).get(`/waba/inbox/attachments/${recent.id}`).query({ accountId }).expect(200)
        expect(response.body.toString()).toBe('%PDF-1.4\n')
        expect(response.headers['content-disposition']).toContain('brief.pdf')
        expect(response.headers['cache-control']).toBe('private, no-store')
        expect(String(fetchMock.mock.calls[0][0])).toContain('phone_number_id=test-phone-id')
        expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer fake')
        fetchMock.mockClear().mockResolvedValue(new Response(JSON.stringify({ url: 'https://example.com/attachment' })))
        await request(app).get(`/waba/inbox/attachments/${recent.id}`).query({ accountId }).expect(502)
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('paginates all stored contacts in batches of 25 and searches beyond the first page', async () => {
        await prisma.whatsAppContact.createMany({ data: Array.from({ length: 54 }, (_, i) => ({
            accountId, phone: `919123450${String(i).padStart(3, '0')}`,
            displayName: `Customer ${i}`, lastMessageAt: new Date(Date.now() - i * 86400000),
        })) })
        await prisma.whatsAppMessage.create({ data: {
            accountId, phone: '919123459999', direction: 'INBOUND', body: 'Legacy import',
            createdAt: new Date(Date.now() - 60 * 86400000),
        } })
        const pages = await Promise.all([1, 2, 3].map(page =>
            request(app).get('/waba/inbox').query({ accountId, page }).expect(200),
        ))
        expect(pages.map(result => result.body.conversations.length)).toEqual([25, 25, 5])
        expect(pages.map(result => result.body.hasNext)).toEqual([true, true, false])
        expect(new Set(pages.flatMap(result => result.body.conversations.map((row: any) => row.id))).size).toBe(55)
        const match = await request(app).get('/waba/inbox').query({ accountId, search: 'legacy import' }).expect(200)
        expect(match.body.conversations).toEqual([expect.objectContaining({ lastMessage: 'Legacy import' })])
    })

    it('loads older history without a date limit and keeps equal timestamps paginated correctly', async () => {
        const date = new Date(Date.now() - 45 * 86400000)
        await prisma.whatsAppMessage.createMany({ data: Array.from({ length: 117 }, (_, i) => ({
            id: `history-${String(i).padStart(3, '0')}`, accountId, phone, direction: 'INBOUND', body: `Message ${i}`, createdAt: date,
        })) })
        const first = await request(app).get(`/waba/inbox/${phone}`).query({ accountId }).expect(200)
        const second = await request(app).get(`/waba/inbox/${phone}`).query({ accountId, before: first.body.olderCursor }).expect(200)
        const third = await request(app).get(`/waba/inbox/${phone}`).query({ accountId, before: second.body.olderCursor }).expect(200)
        expect([first, second, third].map(result => result.body.messages.length)).toEqual([50, 50, 17])
        expect(third.body.olderCursor).toBeNull()
        expect(third.body.messages[0].body).toBe('Message 0')
        expect(new Set([first, second, third].flatMap(result => result.body.messages.map((row: any) => row.id))).size).toBe(117)
    })

    it('recovers unassigned and former-number chats without attaching them to the current number', async () => {
        const createdAt = new Date('2025-01-01T10:00:00Z')
        await prisma.whatsAppMessage.createMany({ data: [
            { phone, accountId: null, direction: 'INBOUND', body: 'Unassigned history', createdAt },
            { phone, accountId: 'old-number', direction: 'INBOUND', body: 'Former number history', createdAt },
            { phone, accountId, direction: 'INBOUND', body: 'Current number', createdAt },
        ] })
        const all = await request(app).get('/waba/inbox').query({ scope: 'all' }).expect(200)
        expect(all.body.conversations.filter((row: any) => row.archived).map((row: any) => row.accountId))
            .toEqual(expect.arrayContaining([null, 'old-number']))
        const scoped = await request(app).get('/waba/inbox').query({ accountId }).expect(200)
        expect(scoped.body.conversations).toHaveLength(1)
        const legacy = await request(app).get(`/waba/inbox/${phone}`).query({ archive: true }).expect(200)
        expect(legacy.body.messages.map((row: any) => row.body)).toEqual(['Unassigned history'])
        expect(legacy.body.canReply).toBe(false)
        const former = await request(app).get(`/waba/inbox/${phone}`).query({ archive: true, accountId: 'old-number' }).expect(200)
        expect(former.body.messages.map((row: any) => row.body)).toEqual(['Former number history'])
        await request(app).get(`/waba/inbox/${phone}`).query({ archive: true, accountId }).expect(400)
    })

})
