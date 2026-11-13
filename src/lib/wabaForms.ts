import { createHash } from 'node:crypto'
import { getWabaPrisma } from './adapters'
import { enqueueAssistantJob } from './assistantStore'
import { formsHubSpotToken, hubSpotStatus } from './wabaFormsHubSpot'

type Field = { key: string; label: string; type: string; required: boolean; target: string }
type Destination = { kind: string; portalId?: string; formId?: string; webhookId?: string }
export type WhatsAppForm = { id: string; accountId: string; name: string; fields: Field[]; destination: Destination; metaFlowId: string | null; published: boolean }

export async function formDefinition(input: any) {
    const name = String(input?.name || '').trim()
    if (!name || name.length > 80) throw new Error('Use a form name of 1–80 characters.')
    if (!Array.isArray(input.fields) || !input.fields.length || input.fields.length > 10) throw new Error('Add 1–10 fields.')
    const fields: Field[] = input.fields.map((field: any, index: number) => {
        const label = String(field?.label || '').trim()
        const type = String(field?.type || '')
        const target = String(field?.target || '').trim()
        if (!label || label.length > 20 || !['text', 'email', 'phone'].includes(type) || !/^[a-z][a-z0-9_]{0,63}$/.test(target)) {
            throw new Error('Give each field a label of up to 20 characters, a field type and a destination key.')
        }
        return { key: `field_${index + 1}`, label, type, target, required: Boolean(field.required) }
    })
    if (new Set(fields.map(field => field.target)).size !== fields.length) throw new Error('Each destination key must be unique.')
    const kind = String(input.destination?.kind || '')
    const destination: Destination = { kind }
    if (kind === 'webhook') {
        destination.webhookId = webhookIdentity(webhookUrl())
    } else if (kind === 'contacts' || kind === 'hubspot-form') {
        const status = await hubSpotStatus()
        if (!status.portalId || !status.configured) throw new Error('Connect HubSpot before saving this form.')
        destination.portalId = status.portalId
        if (kind === 'contacts' && !fields.some(field => field.target === 'email' && field.type === 'email' && field.required)) {
            throw new Error('HubSpot contacts need a required Email field mapped to email.')
        }
        if (kind === 'hubspot-form') {
            const formId = String(input.destination?.formId || '').trim()
            if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(formId)) throw new Error('Enter the HubSpot form ID.')
            destination.formId = formId
        }
    } else throw new Error('Choose a destination.')
    return { name, fields, destination }
}

export function metaFormJson(form: WhatsAppForm) {
    return {
        version: '7.2',
        screens: [{
            id: 'FORM', title: form.name.slice(0, 30), terminal: true, success: true,
            layout: { type: 'SingleColumnLayout', children: [{
                type: 'Form', name: 'answers', children: [
                    ...form.fields.map(field => ({
                        type: 'TextInput', name: field.key, label: field.label, required: field.required,
                        'input-type': field.type,
                    })),
                    { type: 'Footer', label: 'Submit', 'on-click-action': {
                        name: 'complete', payload: Object.fromEntries(form.fields.map(field => [field.key, '${form.' + field.key + '}'])),
                    } },
                ],
            }] },
        }],
    }
}

function webhookUrl() {
    const url = new URL(process.env.WABA_FORMS_WEBHOOK_URL || 'https://invalid.invalid')
    if (url.hostname === 'invalid.invalid' || url.protocol !== 'https:' || url.username || url.password || url.hash || !process.env.WABA_FORMS_WEBHOOK_TOKEN) {
        throw new Error('Set the HTTPS webhook URL and token on the Wabix server.')
    }
    return url
}

function webhookIdentity(url: URL) {
    return createHash('sha256').update(url.href).digest('hex')
}

export async function queueFormReply(accountId: string, phone: string, raw: any) {
    let answers: Record<string, unknown>
    try { answers = JSON.parse(raw?.interactive?.nfm_reply?.response_json) }
    catch { return }
    if (!answers || typeof answers !== 'object' || typeof answers.flow_token !== 'string' || !/^[a-f0-9-]{36}$/i.test(answers.flow_token)) return
    const prisma = getWabaPrisma()
    const invite = await prisma.whatsAppFormInvite?.findUnique({ where: { id: answers.flow_token } })
    if (!invite || invite.accountId !== accountId || invite.phone !== phone || +invite.expiresAt < Date.now()) return
    const form: WhatsAppForm | null = await prisma.whatsAppForm.findFirst({ where: { id: invite.formId, accountId, published: true } })
    if (!form) return
    const mapped: [string, string][] = []
    for (const field of form.fields) {
        const value = answers[field.key]
        const text = typeof value === 'string' ? value.trim() : ''
        if ((field.required && !text) || text.length > 4096) return
        if (text) mapped.push([field.target, text])
    }
    await enqueueAssistantJob(`form:${accountId}:${invite.id}`, 'FORM_SUBMISSION', {
        formId: form.id, destination: form.destination, fields: Object.fromEntries(mapped),
    }, accountId, phone)
}

export async function deliverFormSubmission(key: string, payload: { formId: string; destination: Destination; fields: Record<string, string> }) {
    const { destination, fields } = payload
    let url: string | URL
    let token: string
    let body: unknown
    if (destination.kind === 'webhook') {
        url = webhookUrl()
        if (webhookIdentity(url) !== destination.webhookId) throw new Error('The configured webhook changed. Restore the original URL for this form.')
        token = process.env.WABA_FORMS_WEBHOOK_TOKEN!
        body = { submissionId: key, formId: payload.formId, fields }
    } else {
        if (!destination.portalId) throw new Error('This form has no HubSpot portal.')
        token = await formsHubSpotToken(destination.portalId)
        if (destination.kind === 'contacts') {
            url = 'https://api.hubspot.com/crm/objects/2026-09/contacts/batch/upsert'
            body = { inputs: [{ id: fields.email, idProperty: 'email', properties: fields }] }
        } else {
            url = `https://api.hsforms.com/submissions/v3/integration/secure/submit/${destination.portalId}/${destination.formId}`
            body = { fields: Object.entries(fields).map(([name, value]) => ({ name, value })) }
        }
    }
    const response = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'Idempotency-Key': key },
        body: JSON.stringify(body), signal: AbortSignal.timeout(12000), redirect: 'error',
    })
    if (!response.ok || response.status === 207) throw new Error(`Destination returned HTTP ${response.status}.`)
}
