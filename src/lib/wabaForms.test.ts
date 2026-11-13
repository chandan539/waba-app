import { afterEach, expect, it, vi } from 'vitest'
import { setWabaAdapters } from './adapters'
import { deliverFormSubmission, formDefinition, metaFormJson, queueFormReply } from './wabaForms'
import { connectFormsHubSpot, formsHubSpotToken, hubSpotAuthorize } from './wabaFormsHubSpot'

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

it('routes only mapped answers from the intended WhatsApp account and recipient', async () => {
    vi.stubEnv('WABA_FORMS_WEBHOOK_URL', 'https://hooks.example.com/submit')
    vi.stubEnv('WABA_FORMS_WEBHOOK_TOKEN', 'example-token')
    const definition = await formDefinition({
        name: 'Callback', destination: { kind: 'webhook' },
        fields: [{ label: 'Email', type: 'email', required: true, target: 'email' }],
    })
    const form = { ...definition, id: 'f1', accountId: 'a1', metaFlowId: '123', published: true }
    const id = '12345678-1234-1234-1234-123456789abc'
    const upsert = vi.fn()
    setWabaAdapters({ prisma: {
        whatsAppFormInvite: { findUnique: async () => ({ id, formId: form.id, accountId: 'a1', phone: '123', expiresAt: new Date(Date.now() + 1000) }) },
        whatsAppForm: { findFirst: async () => form },
        whatsAppAssistantJob: { upsert },
    } })
    expect(JSON.stringify(metaFormJson(form))).toContain('${form.field_1}')
    const raw = { interactive: { nfm_reply: { response_json: JSON.stringify({ flow_token: id, field_1: 'test@example.com', extra: 'ignore' }) } } }
    await queueFormReply('a2', '123', raw)
    await queueFormReply('a1', '456', raw)
    expect(upsert).not.toHaveBeenCalled()
    await queueFormReply('a1', '123', raw)
    const queued = upsert.mock.calls[0][0].create
    expect(queued).toMatchObject({ key: `form:a1:${id}`, payload: { fields: { email: 'test@example.com' } } })
    const request = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', request)
    await deliverFormSubmission(queued.key, queued.payload)
    expect(request).toHaveBeenCalledWith(new URL('https://hooks.example.com/submit'), expect.objectContaining({
        headers: expect.objectContaining({ 'Idempotency-Key': queued.key }),
        body: JSON.stringify({ submissionId: queued.key, formId: 'f1', fields: { email: 'test@example.com' } }),
    }))
})

it('encrypts the refresh token, pins the destination to the authorized portal, and refreshes on delivery', async () => {
    vi.stubEnv('WABA_HUBSPOT_CLIENT_ID', 'client')
    vi.stubEnv('WABA_HUBSPOT_CLIENT_SECRET', 'secret')
    vi.stubEnv('WABA_HUBSPOT_REDIRECT_URI', 'https://example.com/admin/waba?wabix_hubspot=1')
    vi.stubEnv('WABA_HUBSPOT_TOKEN_KEY', '12'.repeat(32))
    let row: any
    setWabaAdapters({ prisma: { whatsAppFormsHubSpot: {
        upsert: async ({ create }: any) => { row = create },
        findUnique: async () => row,
    } } })
    const request = vi.fn(async () => Response.json({ hub_id: 123, access_token: 'access', refresh_token: 'refresh' }))
    vi.stubGlobal('fetch', request)
    expect(new URL(hubSpotAuthorize('state')).searchParams.get('state')).toBe('state')
    expect(await connectFormsHubSpot('code')).toEqual({ portalId: '123' })
    expect(row.refreshToken).not.toContain('refresh')
    await expect(formsHubSpotToken('456')).rejects.toThrow('Reconnect')
    const fields = { email: 'test@example.com' }
    await deliverFormSubmission('form:1', { formId: 'f1', destination: { kind: 'contacts', portalId: '123' }, fields })
    expect(request).toHaveBeenLastCalledWith('https://api.hubspot.com/crm/objects/2026-09/contacts/batch/upsert',
        expect.objectContaining({ body: JSON.stringify({ inputs: [{ id: fields.email, idProperty: 'email', properties: fields }] }) }))
    await deliverFormSubmission('form:2', { formId: 'f1', destination: { kind: 'hubspot-form', portalId: '123', formId: 'form-id' }, fields })
    expect(request).toHaveBeenLastCalledWith('https://api.hsforms.com/submissions/v3/integration/secure/submit/123/form-id',
        expect.objectContaining({ body: JSON.stringify({ fields: [{ name: 'email', value: fields.email }] }) }))
})
