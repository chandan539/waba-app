import { describe, expect, it } from 'vitest'
import {
    buildTemplateComponents,
    EVENT_WABA_TEMPLATES,
    extractWabaMessageBody,
    isFacebookMessageOrigin,
    isStopKeyword,
    isWabaCustomerCareOpen,
    isWabaCloudRegistered,
    normalizeWabaPhone,
    normalizeWabaPin,
    parseEmbeddedSignupMessage,
    parseWabaWebhookMessages,
    publicWabaAccount,
    publicWabaStatus,
    templateParamsFromContext,
    toMetaTemplateBody,
    toMetaTemplateName,
    verifyMetaWebhookSignature,
} from './waba'
import { embeddedSignupDialogUrl, isAllowedWabaOauthRedirectUri, wabaOauthRedirectUri } from './wabaSignup'
import crypto from 'crypto'

describe('WABA helpers', () => {
    it('normalizes Indian mobiles for Cloud API', () => {
        expect(normalizeWabaPhone('+91 98765 43210')).toBe('919876543210')
        expect(normalizeWabaPhone('09876543210')).toBe('919876543210')
        expect(normalizeWabaPhone('not-a-phone')).toBe('')
        expect(normalizeWabaPin('')).toBe('123456')
        expect(normalizeWabaPin('654321')).toBe('654321')
        expect(isWabaCloudRegistered({ status: 'CONNECTED', platform_type: 'CLOUD_API' })).toBe(true)
        expect(isWabaCloudRegistered({ status: 'PENDING', platform_type: 'NOT_APPLICABLE' })).toBe(false)
    })

    it('converts merge tags to Meta numbered placeholders', () => {
        const converted = toMetaTemplateBody('Hello {{name}}, order {{orderId}} for {{name}}')
        expect(converted.body).toBe('Hello {{1}}, order {{2}} for {{1}}')
        expect(converted.keys).toEqual(['name', 'orderId'])
        expect(toMetaTemplateName('Order Placed!')).toBe('order_placed')
        expect(EVENT_WABA_TEMPLATES).toHaveLength(11)
        expect(new Set(EVENT_WABA_TEMPLATES.map((item) => item.name)).size).toBe(11)
        expect(EVENT_WABA_TEMPLATES.every((item) => item.body.includes('{{name}}'))).toBe(true)
        expect(templateParamsFromContext(['name', 'orderId'], { name: 'Dr Rao', orderId: 'AB12' })).toEqual(['Dr Rao', 'AB12'])
        expect(templateParamsFromContext(['1', '2'], { name: 'Dr Rao', email: 'clinic@example.com' })).toEqual(['Dr Rao', 'clinic@example.com'])
        expect(templateParamsFromContext(['1', '2'], {})).toEqual(['there', 'your email'])
        expect(buildTemplateComponents(converted.body, converted.keys)[0]).toMatchObject({ type: 'BODY', text: converted.body })
    })

    it('hides secrets in public status and verifies webhook signatures', () => {
        const status = publicWabaStatus({
            id: 'acct-1',
            isSelected: true,
            metaAppId: '123',
            accessToken: 'secret-token',
            metaAppSecret: 'app-secret',
            wabaId: 'waba',
            phoneNumberId: 'phone',
        }, 'https://api.example.com/api/whatsapp/webhook')
        expect(status.connected).toBe(true)
        expect(status.id).toBe('acct-1')
        expect(status.isSelected).toBe(true)
        expect(publicWabaAccount({ id: 'acct-1', displayPhone: '+91 90000 00000', wabaId: 'w', phoneNumberId: 'p', accessToken: 't' }).label).toBe('+91 90000 00000')
        expect(status.hasToken).toBe(true)
        expect(status.embeddedSignupVersion).toBe('v4')
        expect(status.graphVersion).toBe('v26.0')
        expect(JSON.stringify(status)).not.toContain('secret-token')
        expect(JSON.stringify(status)).not.toContain('app-secret')
        expect(isStopKeyword('STOP')).toBe(true)
        expect(isStopKeyword('hello')).toBe(false)
        const body = Buffer.from('{"object":"whatsapp_business_account"}')
        const sig = `sha256=${crypto.createHmac('sha256', 'app-secret').update(body).digest('hex')}`
        expect(verifyMetaWebhookSignature(body, sig, 'app-secret')).toBe(true)
        expect(verifyMetaWebhookSignature(body, sig, 'other')).toBe(false)
    })

    it('parses Embedded Signup v4 session messages', () => {
        expect(isFacebookMessageOrigin('https://www.facebook.com')).toBe(true)
        expect(isFacebookMessageOrigin('https://web.facebook.com')).toBe(true)
        expect(isFacebookMessageOrigin('https://evil.example')).toBe(false)
        const finished = parseEmbeddedSignupMessage({
            type: 'WA_EMBEDDED_SIGNUP',
            event: 'FINISH',
            data: { phone_number_id: '111', waba_id: '222', business_id: '333' },
        })
        expect(finished).toMatchObject({ finished: true, wabaId: '222', phoneNumberId: '111', businessId: '333' })
        const wabaOnly = parseEmbeddedSignupMessage(JSON.stringify({
            type: 'WA_EMBEDDED_SIGNUP',
            event: 'FINISH_ONLY_WABA',
            data: { waba_ids: ['444'], business_id: '555' },
        }))
        expect(wabaOnly).toMatchObject({ finished: true, wabaId: '444', phoneNumberId: '', businessId: '555' })
        const cancelled = parseEmbeddedSignupMessage({
            type: 'WA_EMBEDDED_SIGNUP',
            event: 'CANCEL',
            data: { current_step: 'PHONE_NUMBER_SETUP' },
        })
        expect(cancelled).toMatchObject({ cancelled: true, currentStep: 'PHONE_NUMBER_SETUP' })
        expect(parseEmbeddedSignupMessage({ type: 'OTHER' })).toBeNull()
        const redirectUri = wabaOauthRedirectUri('https://admin.example.com/')
        const dialog = embeddedSignupDialogUrl({
            appId: '133',
            configId: '1085',
            redirectUri,
        })
        expect(redirectUri).toBe('https://admin.example.com/admin/waba')
        expect(isAllowedWabaOauthRedirectUri('http://localhost:3000/admin/waba')).toBe(true)
        expect(isAllowedWabaOauthRedirectUri('https://evil.example/admin/waba')).toBe(false)
        expect(dialog).toContain('config_id=1085')
        expect(dialog).toContain('response_type=code')
        expect(dialog).toContain(`redirect_uri=${encodeURIComponent(redirectUri)}`)
        expect(dialog).not.toContain('scope=openid')
        expect(dialog).not.toContain('response_type=token')
    })

    it('parses inbound WhatsApp webhook messages for the inbox', () => {
        expect(extractWabaMessageBody({ type: 'text', text: { body: 'Need AndroWash demo' } })).toEqual({ type: 'text', body: 'Need AndroWash demo' })
        expect(isWabaCustomerCareOpen(new Date(), new Date())).toBe(true)
        expect(isWabaCustomerCareOpen(new Date(Date.now() - 25 * 60 * 60 * 1000))).toBe(false)
        const parsed = parseWabaWebhookMessages({
            entry: [{
                changes: [{
                    field: 'messages',
                    value: {
                        metadata: { phone_number_id: 'phone-1' },
                        contacts: [{ wa_id: '919876543210', profile: { name: 'Dr Rao' } }],
                        messages: [{
                            from: '9876543210',
                            id: 'wamid.abc',
                            timestamp: '1710000000',
                            type: 'text',
                            text: { body: 'Hello' },
                        }],
                    },
                }],
            }],
        })
        expect(parsed).toHaveLength(1)
        expect(parsed[0]).toMatchObject({ phone: '919876543210', body: 'Hello', contactName: 'Dr Rao', metaMessageId: 'wamid.abc', phoneNumberId: 'phone-1', direction: 'INBOUND' })
        const echoes = parseWabaWebhookMessages({
            entry: [{
                changes: [{
                    field: 'smb_message_echoes',
                    value: {
                        metadata: { phone_number_id: 'phone-1' },
                        message_echoes: [{ to: '919876543210', id: 'wamid.out', timestamp: '1710000001', type: 'text', text: { body: 'Sent from phone' } }],
                    },
                }, {
                    field: 'history',
                    value: {
                        metadata: { phone_number_id: 'phone-1' },
                        history: [{ threads: [{ id: '919111111111', messages: [{ from: '919111111111', id: 'wamid.hist', timestamp: '1710000002', type: 'text', text: { body: 'Earlier hi' } }] }] }],
                    },
                }],
            }],
        })
        expect(echoes.map((item) => ({ phone: item.phone, direction: item.direction, body: item.body }))).toEqual([
            { phone: '919876543210', direction: 'OUTBOUND', body: 'Sent from phone' },
            { phone: '919111111111', direction: 'INBOUND', body: 'Earlier hi' },
        ])
        const missingFrom = parseWabaWebhookMessages({
            entry: [{
                changes: [{
                    field: 'messages',
                    value: {
                        contacts: [{ wa_id: '919111222333', profile: { name: 'Clinic' } }],
                        messages: [{ id: 'wamid.nofrom', type: 'text', text: { body: 'Reply' } }],
                    },
                }],
            }],
        })
        expect(missingFrom).toHaveLength(1)
        expect(missingFrom[0]).toMatchObject({ phone: '919111222333', body: 'Reply', contactName: 'Clinic', direction: 'INBOUND' })
    })
})
