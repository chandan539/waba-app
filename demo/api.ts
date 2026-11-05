import axios, { AxiosError } from 'axios'
import { assistantDefaults } from '../src/lib/assistantDefaults'
import version from '../src/lib/wabaVersion.json'

const accounts = Array.from({ length: 45 }, (_, i) => ({
    id: `demo-${i + 1}`, label: ['Enterprise HQ', 'Customer Success', 'Sales Desk'][i] || `Business number ${i + 1}`,
    displayName: ['Enterprise HQ', 'Customer Success', 'Sales Desk'][i] || `Regional team ${i + 1}`,
    displayPhone: `+1 (202) 555-01${String(i).padStart(2, '0')}`,
    phoneNumberId: `demo-phone-${i + 1}`, wabaId: 'demo', connected: true, pendingPhone: false,
}))
const templates = ['test_account_ready', 'test_order_confirmation', 'test_shipping_update'].map((name, i) => ({
    id: String(i + 1), name, status: 'APPROVED', category: 'UTILITY', bodyText: ['Your account is ready. Welcome!', 'We received your order and will send a shipping update.', 'Your order has shipped.'][i],
}))
const now = () => new Date().toISOString()
const people = [
    { id: 'c1', displayName: 'Sarah Jenkins', phone: '12025550180', lastMessage: 'Can we schedule a technical walkthrough for Thursday?', unreadCount: 1 },
    { id: 'c2', displayName: 'Marcus Kane', phone: '12025550181', lastMessage: 'Thanks! Can you share your pricing?', unreadCount: 2 },
    { id: 'c3', displayName: 'Elena Rostova', phone: '12025550182', lastMessage: 'I’ll check with our team and get back to you.', unreadCount: 0 },
]
type Workspace = {
    settings: typeof assistantDefaults
    flows: any[]
    slots: any[]
    handovers: any[]
    replies: Record<string, any[]>
}
type State = { selected: string; workspaces: Record<string, Workspace> }
const storageKey = 'wabix-demo-v1'
const state: State = (() => {
    try { return JSON.parse(localStorage.getItem(storageKey) || 'null') || { selected: accounts[0].id, workspaces: {} } }
    catch { return { selected: accounts[0].id, workspaces: {} } }
})()
function save() {
    try { localStorage.setItem(storageKey, JSON.stringify(state)) } catch { /* Private browsing can disable storage. */ }
}
function workspace(id: string): Workspace {
    return state.workspaces[id] ||= {
        settings: { ...assistantDefaults, businessName: accounts.find(item => item.id === id)?.displayName || 'Demo business', bookingEnabled: true, knowledge: 'Our team offers a 30-minute product walkthrough. Choose Book a call to view available sessions.' },
        flows: [{ id: crypto.randomUUID(), name: 'Order confirmation', triggerType: 'ORDER_PLACED', isActive: false, steps: [{ id: crypto.randomUUID(), sequenceOrder: 1, delayHours: 0, templateName: templates[1].name }] }],
        slots: [], handovers: [], replies: {},
    }
}
export const demoSettings = () => workspace(state.selected).settings

axios.defaults.adapter = async config => {
    const url = new URL(config.url || '/', location.origin)
    const method = config.method || 'get'
    const body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data || {}
    const account = accounts.find(item => item.id === state.selected) || accounts[0]
    const inboxAccountId = String(config.params?.accountId || body.accountId || account.id)
    const current = workspace(config.url?.includes('/inbox') ? inboxAccountId : account.id)
    const path = url.pathname.replace(/^\/api\/admin\/waba/, '')
    const fail = (message: string): never => {
        throw new AxiosError(message, 'ERR_BAD_REQUEST', config, undefined, { data: { error: message }, status: 400, statusText: 'Demo request', headers: {}, config })
    }
    let data: any = { success: true }
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/admin/waba')) fail('Only demo data is available.')
    if (!path) {
        data = { status: { ...account, isSelected: true, cloudRegistered: true, lastWebhookAt: now(), webhookUrl: 'Demo only', accounts: accounts.map(item => ({ ...item, isSelected: item.id === account.id })) }, templates, queue: [], campaigns: [] }
    } else if (path === '/accounts/select') {
        if (!accounts.some(item => item.id === body.accountId)) fail('Demo number not found.')
        state.selected = body.accountId
    } else if (path === '/analytics') {
        const days = Number(config.params?.days) === 7 ? 7 : 30
        const seed = Number(account.id.slice(5))
        data = { leads: 12 + seed, bookings: 5 + seed, handovers: current.handovers.length, daily: Array.from({ length: days }, (_, i) => {
            const activity = (i * 17 + seed * 9) % 41
            return { day: new Date(Date.now() - (days - 1 - i) * 86400000).toISOString().slice(0, 10), inbound: 12 + activity, outbound: 25 + activity, delivered: 22 + activity, read: 16 + activity }
        }) }
    } else if (path === '/updates') {
        data = { installedVersion: version.version, canUpdate: false, available: null, releasesUrl: 'https://github.com/chandan539/waba-app/releases' }
    } else if (path === '/assistant') {
        data = { settings: current.settings, leads: [{ id: 'demo-lead', phone: people[0].phone, kind: 'enquiry', createdAt: now(), details: { text: 'Interested in a product walkthrough for our support team.' } }], bookings: [], slots: current.slots, handovers: current.handovers, jobs: [], deliveries: [], readiness: {} }
    } else if (path === '/assistant/settings' && method === 'put') {
        current.settings = body.settings
        data = { settings: current.settings }
    } else if (path === '/assistant/slots' && method === 'post') {
        const slot = { id: crypto.randomUUID(), ...body }
        current.slots.push(slot)
        data = { slot }
    } else if (path.startsWith('/assistant/slots/') && method === 'delete') {
        current.slots = current.slots.filter(item => item.id !== path.split('/').pop())
    } else if (path === '/assistant/handover' && method === 'post') {
        current.handovers = current.handovers.filter(item => item.phone !== body.phone)
        if (body.handover) current.handovers.push({ id: crypto.randomUUID(), phone: body.phone })
    } else if (path === '/inbox') {
        const ids = config.params?.scope === 'all' ? accounts.map(item => item.id) : [inboxAccountId]
        const search = String(config.params?.search || '').trim().toLowerCase()
        const start = (Number(config.params?.page || 1) - 1) * 20
        const rows = ids.flatMap((id, index) => people.slice(0, index === 0 ? 3 : 1).map(person => ({
            ...person, id: `${id}:${person.id}`, accountId: id,
            lastMessageAt: new Date(Date.now() - index * 86400000).toISOString(),
        }))).filter(person =>
            (!config.params?.unread || person.unreadCount > 0) &&
            `${person.displayName} ${person.phone} ${person.lastMessage}`.toLowerCase().includes(search),
        )
        data = { templates, conversations: rows.slice(start, start + 20), hasNext: rows.length > start + 20 }
    } else if (path === '/inbox/read') {
        // Read receipts are simulated.
    } else if (path === '/inbox/reply' || path === '/inbox/template') {
        const replies = current.replies[body.phone] ||= []
        replies.push({ id: crypto.randomUUID(), direction: 'OUTBOUND', type: 'text', body: body.text || templates.find(item => item.id === body.templateId)?.bodyText, status: 'sent', createdAt: now() })
    } else if (path.startsWith('/inbox/attachments/') && method === 'get') {
        const filename = path.endsWith('/demo-pdf') ? 'sample-brief.pdf' : path.endsWith('/demo-image') ? 'sample-image.png' : null
        if (!filename) fail('Demo attachment not found.')
        data = await fetch(`/samples/${filename}`).then(result => {
            if (!result.ok) throw new Error('Demo attachment unavailable.')
            return result.blob()
        })
    } else if (path.startsWith('/inbox/') && method === 'get') {
        const phone = decodeURIComponent(path.slice('/inbox/'.length))
        const person = people.find(item => item.phone === phone)
        const expiresAt = new Date(Date.now() + 86400000).toISOString()
        const attachmentMessages = person?.id === 'c1' ? [
            { id: 'demo-pdf', direction: 'INBOUND', type: 'document', body: 'Here is our sample project brief.', createdAt: now(), attachment: { filename: 'sample-brief.pdf', expiresAt } },
            { id: 'demo-image', direction: 'INBOUND', type: 'image', body: 'And a sample image.', createdAt: now(), attachment: { filename: 'sample-image.png', expiresAt } },
            { id: 'demo-contact', direction: 'INBOUND', type: 'contacts', body: '[contacts]', createdAt: now(), sharedContacts: [{ name: 'Jordan Lee', company: 'Example Studio', phones: ['+1 202-555-0190'], emails: ['jordan@example.com'] }] },
        ] : []
        const previousMessages = person?.id === 'c1' ? Array.from({ length: 55 }, (_, i) => ({
            id: `history-${i}`, direction: i % 2 ? 'OUTBOUND' : 'INBOUND', type: 'text',
            body: i === 0 ? 'Our first conversation about the project.' : `Sample project update ${i}.`,
            createdAt: new Date(Date.now() - (55 - i) * 86400000).toISOString(),
        })) : []
        const history = [
            ...previousMessages,
            ...(person ? [{ id: 'initial', direction: 'INBOUND', type: 'text', body: person.lastMessage, createdAt: now() }] : []),
            ...attachmentMessages, ...(current.replies[phone] || []),
        ]
        const end = config.params?.before ? history.findIndex(message => message.id === config.params.before) : history.length
        if (end < 0) fail('History marker not found.')
        const start = Math.max(0, end - 50)
        data = {
            contact: person && { ...person, unreadCount: 0 }, canReply: true, templates,
            messages: history.slice(start, end), olderCursor: start > 0 ? history[start].id : null,
        }
    } else if (path === '/flows' && method === 'get') {
        data = { flows: current.flows }
    } else if (path === '/flows' && method === 'post') {
        const flow = { ...body, id: crypto.randomUUID(), steps: [] }
        current.flows.push(flow)
        data = { flow }
    } else if (path.startsWith('/flows/')) {
        const flow = current.flows.find(item => item.id === path.split('/')[2])
        if (!flow) fail('Demo workflow not found.')
        if (path.endsWith('/steps') && method === 'post') {
            flow.steps.push({ ...body, id: crypto.randomUUID() })
            flow.steps.sort((a: any, b: any) => a.sequenceOrder - b.sequenceOrder)
        } else if (method === 'put') Object.assign(flow, body)
        else if (method === 'delete') current.flows = current.flows.filter(item => item.id !== flow.id)
        else fail('This action is unavailable in the demo.')
    } else if (path.startsWith('/flow-steps/') && method === 'delete') {
        for (const flow of current.flows) flow.steps = flow.steps.filter((item: any) => item.id !== path.split('/').pop())
    } else fail('This action needs a connected host app. The public demo uses sample data only.')
    if (method !== 'get') save()
    return { data, status: 200, statusText: 'OK', headers: {}, config }
}
