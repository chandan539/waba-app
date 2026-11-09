'use client'

import { useEffect, useRef, useState } from 'react'
import { useWabaApi } from './WabaHost'
import { BarChart3, Smartphone, Bot, Loader2, MessageSquare, Workflow, FileText, Megaphone, Plug, ChevronRight, Layers } from 'lucide-react'
import { cn } from '../lib/cn'
import { WABA_GRAPH_VERSION, WABA_OAUTH_REDIRECT_PATH, embeddedSignupDialogUrl, isFacebookMessageOrigin, parseEmbeddedSignupMessage } from '../lib/wabaSignup'
import { WABA_FEATURE_PAUSED } from '../lib/wabaFlags'
import { WabaInbox } from './WabaInbox'
import { WabaFlows } from './WabaFlows'
import { WabaAssistant } from './WabaAssistant'
import { WabaUpdates } from './WabaUpdates'

import { WabaChannels } from './WabaChannels'
import { WabaAnalytics } from './WabaAnalytics'

type Tab = 'channels' | 'analytics' | 'numbers' | 'assistant' | 'inbox' | 'flows' | 'connect' | 'templates' | 'campaigns'
type Account = {
    id: string
    isSelected: boolean
    connected: boolean
    pendingPhone: boolean
    wabaId: string
    phoneNumberId: string
    displayName: string
    displayPhone: string
    qualityRating: string
    connectedAt: string | null
    label: string
}
type Status = {
    id: string
    isSelected: boolean
    connected: boolean
    pendingPhone: boolean
    metaAppId: string
    embeddedSignupConfigId: string
    wabaId: string
    phoneNumberId: string
    businessId: string
    displayName: string
    displayPhone: string
    qualityRating: string
    connectedAt: string | null
    cloudRegistered: boolean
    phoneStatus: string
    platformType: string
    codeVerificationStatus: string
    nameStatus: string
    accountMode: string
    canSendMessage: string
    healthError: string
    reviewStatus: string
    hasToken: boolean
    hasAppSecret: boolean
    verifyTokenSet: boolean
    verifyToken: string
    webhookUrl: string
    webhookSetupError: string
    oauthPath: string
    oauthOrigins: string[]
    lastWebhookAt: string | null
    lastWebhookFields: string
    graphVersion: string
    embeddedSignupVersion: string
}

const emptyStatus: Status = {
    id: '',
    isSelected: false,
    connected: false,
    pendingPhone: false,
    metaAppId: '',
    embeddedSignupConfigId: '',
    wabaId: '',
    phoneNumberId: '',
    businessId: '',
    displayName: '',
    displayPhone: '',
    qualityRating: '',
    connectedAt: null,
    cloudRegistered: false,
    phoneStatus: '',
    platformType: '',
    codeVerificationStatus: '',
    nameStatus: '',
    accountMode: '',
    canSendMessage: '',
    healthError: '',
    reviewStatus: '',
    hasToken: false,
    hasAppSecret: false,
    verifyTokenSet: false,
    verifyToken: '',
    webhookUrl: '',
    webhookSetupError: '',
    oauthPath: '',
    oauthOrigins: [],
    lastWebhookAt: null,
    lastWebhookFields: '',
    graphVersion: WABA_GRAPH_VERSION,
    embeddedSignupVersion: 'v4',
}

const TABS: { id: Tab; label: string }[] = [
    { id: 'assistant', label: 'AI assistant' },
    { id: 'inbox', label: 'Shared inbox' },
    { id: 'flows', label: 'Automation' },
    { id: 'templates', label: 'Templates' },
    { id: 'campaigns', label: 'Campaigns' },
    { id: 'analytics', label: 'Analytics' },
    { id: 'numbers', label: 'WhatsApp numbers' },
    { id: 'connect', label: 'Settings' },
]

const channelsTab = { id: 'channels', label: 'Channels' } as const
const tabIcons = { channels: Layers, analytics: BarChart3, numbers: Smartphone, assistant: Bot, inbox: MessageSquare, flows: Workflow, templates: FileText, campaigns: Megaphone, connect: Plug }

const emptySignupSession = { wabaId: '', phoneNumberId: '', businessId: '', event: '', cancelled: false, currentStep: '', errorMessage: '', errorCode: '', sessionId: '' }

const inputClass = 'w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-normal text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600/20'
const btnClass = 'inline-flex h-11 items-center justify-center rounded-lg bg-[#00685d] px-4 text-sm font-semibold text-white disabled:opacity-50'
const ghostClass = 'inline-flex h-11 items-center justify-center rounded-lg bg-slate-100 px-4 text-sm font-semibold text-slate-700'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            {label}
            {children}
        </label>
    )
}

export function WabaBoard({ channels = false }: { channels?: boolean } = {}) {
    const api = useWabaApi()
    const [tab, setTab] = useState<Tab>(channels ? 'channels' : 'inbox')
    const [status, setStatus] = useState<Status>(emptyStatus)
    const [numberPage, setNumberPage] = useState(0)
    const [accounts, setAccounts] = useState<Account[]>([])
    const [templates, setTemplates] = useState<any[]>([])
    const [campaigns, setCampaigns] = useState<any[]>([])
    const [queue, setQueue] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [settings, setSettings] = useState({ metaAppId: '', embeddedSignupConfigId: '', metaAppSecret: '' })
    const [manual, setManual] = useState({ accessToken: '', wabaId: '', phoneNumberId: '', pin: '123456' })
    const [templateForm, setTemplateForm] = useState({ name: 'order_placed', language: 'en', category: 'UTILITY', body: 'Hello {{name}}, your order {{orderId}} is confirmed. Total {{total}}.' })
    const [campaignForm, setCampaignForm] = useState({ name: '', templateId: '', audience: 'ORDERS' })
    const [testPhone, setTestPhone] = useState('')
    const popupRef = useRef<Window | null>(null)
    const popupCleanup = useRef<() => void>(() => {})
    const [loadError, setLoadError] = useState('')
    const [signupError, setSignupError] = useState('')
    const redirectUri = typeof window === 'undefined' ? '' : window.location.origin + (status.oauthPath || WABA_OAUTH_REDIRECT_PATH)
    const signupSession = useRef(emptySignupSession)
    const reportSignupError = (message: string) => {
        const { errorCode, sessionId } = signupSession.current
        setSignupError([message, errorCode && `Meta code ${errorCode}.`, sessionId && `Session ID ${sessionId}.`].filter(Boolean).join(' '))
    }

    const load = async () => {
        const res = await api.get('')
        setLoadError('')
        setStatus({ ...emptyStatus, ...(res.data.status || {}) })
        setAccounts(res.data.status?.accounts || [])
        setTemplates(res.data.templates || [])
        setCampaigns(res.data.campaigns || [])
        setQueue(res.data.queue || [])
        setSettings((prev) => ({
            ...prev,
            metaAppId: res.data.status?.metaAppId || '',
            embeddedSignupConfigId: res.data.status?.embeddedSignupConfigId || '',
        }))
    }

    useEffect(() => {
        if (WABA_FEATURE_PAUSED) {
            setLoading(false)
            return
        }
        if (typeof window !== 'undefined') {
            const params = new URLSearchParams(window.location.search)
            const oauthReturn = Boolean(params.get('state') && (params.get('code') || params.get('error') || params.get('error_description')))
            const isPopup = Boolean(window.opener && window.opener !== window)
            if (oauthReturn && isPopup) {
                setLoading(false)
                return
            }
        }
        load().catch((error) => setLoadError(error.response?.data?.error || 'Could not load WABA. Check the host API connection.')).finally(() => setLoading(false))
    }, [])

    useEffect(() => {
        const onMessage = (event: MessageEvent) => {
            if (!isFacebookMessageOrigin(event.origin) || event.source !== popupRef.current) return
            const parsed = parseEmbeddedSignupMessage(event.data)
            if (!parsed) return
            signupSession.current = {
                wabaId: parsed.wabaId,
                phoneNumberId: parsed.phoneNumberId,
                businessId: parsed.businessId,
                event: parsed.event,
                cancelled: parsed.cancelled,
                currentStep: parsed.currentStep,
                errorMessage: parsed.errorMessage,
                errorCode: parsed.errorCode,
                sessionId: parsed.sessionId,
            }
            if (parsed.errorMessage) reportSignupError(parsed.errorMessage)
            if (parsed.finished && typeof window !== 'undefined') {
                sessionStorage.setItem('waba_es_session', JSON.stringify({
                    wabaId: parsed.wabaId,
                    phoneNumberId: parsed.phoneNumberId,
                    businessId: parsed.businessId,
                }))
            }
        }
        window.addEventListener('message', onMessage)
        return () => { window.removeEventListener('message', onMessage); popupCleanup.current() }
    }, [])

    const exchangeCode = async (code: string, callback: string) => {
        const started = Date.now()
        while (Date.now() - started < 2500) {
            if (signupSession.current.wabaId || signupSession.current.cancelled) break
            await new Promise((resolve) => setTimeout(resolve, 150))
        }
        let session = signupSession.current
        if (!session.wabaId && typeof window !== 'undefined') {
            try {
                const stored = JSON.parse(sessionStorage.getItem('waba_es_session') || '{}')
                session = {
                    ...session,
                    wabaId: session.wabaId || String(stored.wabaId || ''),
                    phoneNumberId: session.phoneNumberId || String(stored.phoneNumberId || ''),
                    businessId: session.businessId || String(stored.businessId || ''),
                }
            } catch {
                // Ignore malformed session leftovers.
            }
        }
        const pin = sessionStorage.getItem('waba_pin') || manual.pin
        await api.post('/embedded-signup', {
            code,
            wabaId: session.wabaId,
            phoneNumberId: session.phoneNumberId,
            businessId: session.businessId,
            pin,
            redirectUri: callback,
        })
        if (typeof window !== 'undefined') {
            sessionStorage.removeItem('waba_pin')
            sessionStorage.removeItem('waba_es_session')
        }
    }

    useEffect(() => {
        if (typeof window === 'undefined') return
        const params = new URLSearchParams(window.location.search)
        const code = params.get('code')
        const error = params.get('error_description') || params.get('error')
        const state = params.get('state')
        if (!state || (!code && !error)) return
        if (window.opener && window.opener !== window) {
            window.opener.postMessage({ type: 'WABA_OAUTH_RESULT', code, state, error }, window.location.origin)
            return
        }
        if (state !== sessionStorage.getItem('waba_oauth_state')) return
        const callback = sessionStorage.getItem('waba_oauth_redirect') || ''
        sessionStorage.removeItem('waba_oauth_state')
        sessionStorage.removeItem('waba_oauth_redirect')
        const cleanUrl = new URL(window.location.href)
        for (const name of ['code', 'state', 'error', 'error_description', 'error_reason', 'error_code']) cleanUrl.searchParams.delete(name)
        window.history.replaceState(window.history.state, '', cleanUrl)
        if (error) { reportSignupError(error); return }
        void completeSignup(code!, callback)
    }, [])

    const run = async (work: () => Promise<void>) => {
        setSaving(true)
        try {
            await work()
        } catch (error: any) {
            alert(error.response?.data?.error || error.message || 'WABA request failed')
        } finally {
            await load().catch(() => null)
            setSaving(false)
        }
    }

    const completeSignup = (code: string, callback: string) => run(async () => {
        try { await exchangeCode(code, callback); setSignupError('') }
        catch (error: any) { reportSignupError(error.response?.data?.error || error.message || 'Could not complete Meta signup.') }
    })

    const connectWithMeta = () => {
        if (popupRef.current && !popupRef.current.closed) { popupRef.current.focus(); return }
        setSignupError('')
        signupSession.current = emptySignupSession
        const appId = status.metaAppId
        const configId = status.embeddedSignupConfigId
        if (!appId || !configId || !status.hasAppSecret) {
            setTab('connect')
            reportSignupError('Save your Meta App ID, App Secret, and Embedded Signup configuration ID first.')
            return
        }
        const callback = new URL(redirectUri)
        const local = ['localhost', '127.0.0.1'].includes(callback.hostname)
        if (!local && callback.protocol !== 'https:') {
            reportSignupError('Meta connection requires an HTTPS admin page.')
            return
        }
        if (!local && status.oauthOrigins.length && !status.oauthOrigins.includes(callback.origin)) {
            reportSignupError('This host is missing from WABA_ADMIN_ORIGIN or WABA_OAUTH_ORIGINS. Add it on the server and allow the callback URL in Meta.')
            return
        }
        if (status.webhookSetupError) { reportSignupError(status.webhookSetupError); return }
        popupCleanup.current()
        sessionStorage.removeItem('waba_es_session')
        const state = window.crypto.randomUUID()
        const url = embeddedSignupDialogUrl({ appId, configId, redirectUri, state })
        sessionStorage.setItem('waba_oauth_state', state)
        sessionStorage.setItem('waba_oauth_redirect', redirectUri)
        sessionStorage.setItem('waba_pin', manual.pin || '')
        const popup = window.open(url, 'fb_waba_es', 'width=620,height=780,scrollbars=yes')
        if (!popup) {
            window.location.assign(url)
            return
        }
        popupRef.current = popup
        let finished = false
        const cleanup = () => {
            window.clearInterval(timer)
            window.removeEventListener('message', onResult)
            popupCleanup.current = () => {}
            popupRef.current = null
            try { popup.close() } catch {}
        }
        const finish = (code: string | null, resultState: string | null, error: string | null) => {
            if (finished || resultState !== state) return
            finished = true
            cleanup()
            sessionStorage.removeItem('waba_oauth_state')
            sessionStorage.removeItem('waba_oauth_redirect')
            if (code) void completeSignup(code, redirectUri)
            else reportSignupError(error || signupSession.current.errorMessage || 'Meta did not return an authorization code.')
        }
        const onResult = (event: MessageEvent) => {
            if (event.origin !== window.location.origin || event.source !== popup || event.data?.type !== 'WABA_OAUTH_RESULT') return
            finish(event.data.code, event.data.state, event.data.error)
        }
        const timer = window.setInterval(() => {
            if (popup.closed) {
                if (!signupSession.current.errorMessage) {
                    reportSignupError('Meta signup closed before returning an authorization code. If Meta showed an error, save its session ID and check the app in Meta for Developers.')
                }
                cleanup()
                sessionStorage.removeItem('waba_oauth_state')
                sessionStorage.removeItem('waba_oauth_redirect')
                return
            }
            try {
                const result = new URL(popup.location.href)
                if (result.origin !== callback.origin || result.pathname !== callback.pathname) return
                const code = result.searchParams.get('code')
                const error = result.searchParams.get('error_description') || result.searchParams.get('error')
                if (code || error) finish(code, result.searchParams.get('state'), error)
            } catch { /* Meta owns the popup until it redirects. */ }
        }, 400)
        popupCleanup.current = cleanup
        window.addEventListener('message', onResult)
    }

    if (WABA_FEATURE_PAUSED) {
        return (
            <div className="space-y-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">Marketing</p>
                <h1 className="font-sans text-3xl font-semibold text-slate-900">WhatsApp <span className="text-blue-600">WABA</span></h1>
                <p className="max-w-xl rounded-xl bg-amber-50 p-6 text-sm font-semibold text-amber-900">
                    WhatsApp WABA is paused. Inbox polling, campaigns, and event flows are off so they do not hit the database. Connected numbers and templates stay saved. Say when you want this turned back on.
                </p>
                <WabaUpdates />
            </div>
        )
    }

    if (loading) {
        return (
            <div className="flex min-h-[40vh] items-center justify-center text-slate-400">
                <Loader2 className="h-8 w-8 animate-spin" />
            </div>
        )
    }

    if (loadError) return <div role="alert" className="space-y-3 rounded-xl border border-rose-200 bg-rose-50 p-5 text-rose-900">
        <p>{loadError}</p><button type="button" className={ghostClass} onClick={() => void load().catch(() => {})}>Retry connection</button>
    </div>

    const pageCount = Math.max(1, Math.ceil(accounts.length / 20))
    const page = Math.min(numberPage, pageCount - 1)
    const first = page * 20
    const tabs = channels ? [channelsTab, ...TABS] : TABS
    const approved = templates.filter((item) => String(item.status).toUpperCase() === 'APPROVED')

    return (
        <div className="waba-workspace grid min-h-[48rem] overflow-hidden rounded-xl border border-slate-200 bg-[#f7f9fc] text-[#172B4D] md:grid-cols-[210px_minmax(0,1fr)]" style={{ fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' }}>
            <aside className="flex flex-col gap-6 border-b border-slate-200 bg-[#f2f4f7] p-5 md:border-b-0 md:border-r">
                <div className="flex items-center gap-3 py-2"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#00685d] text-white"><MessageSquare size={22} /></span><span className="text-xl font-semibold tracking-tight">Wabix AI</span></div>
                <div className="rounded-lg border border-slate-200 bg-white p-3"><p className="text-xs text-slate-500">WhatsApp workspace</p><p className="mt-1 truncate text-sm font-semibold">{status.displayName || 'Your business'}</p><p className="mt-2 truncate text-xs text-[#00685d]">{status.displayPhone || 'Connect a number to begin'}</p></div>
                <nav aria-label="WhatsApp navigation" className="flex flex-wrap gap-2 md:flex-col">
                    {tabs.map((item) => { const Icon = tabIcons[item.id]; return <button key={item.id} type="button" aria-current={tab === item.id ? 'page' : undefined} onClick={() => setTab(item.id)} className={cn('flex items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-medium transition-colors', tab === item.id ? 'bg-[#00685d] text-white shadow-sm' : 'text-slate-600 hover:bg-white')}><Icon size={18} />{item.label}</button> })}
                </nav>
                <div className="mt-auto rounded-lg border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-500">WhatsApp Business Platform<p className="mt-1 font-medium text-[#00685d]">Customer conversations, connected.</p></div>
            </aside>
            <main className="min-w-0">
                <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-6 py-4"><p className="flex items-center gap-2 text-sm text-slate-500">Workspace <ChevronRight size={14} /><span className="font-medium text-slate-900">{tabs.find(item => item.id === tab)?.label}</span></p><button type="button" onClick={() => setTab('numbers')} title="Switch WhatsApp number" className={cn('rounded-full px-3 py-1.5 text-xs font-medium', status.connected ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>{status.connected ? '● Connected' : status.pendingPhone ? '● Phone pending' : '○ Not connected'}</button></header>
                <div className="space-y-6 p-4 lg:p-7">
                <div><h1 className="text-2xl font-semibold tracking-tight text-slate-900">{tabs.find(item => item.id === tab)?.label}</h1><p className="mt-1 text-sm text-slate-500">{{ channels: 'Connect, switch and share your WhatsApp Business channels.', analytics: 'Track messages, delivery, leads and bookings.', numbers: 'Switch between business numbers or add another connection.', assistant: 'Your business knowledge, conversations and bookings, connected.', inbox: 'Every customer conversation, in one place.', flows: 'Build thoughtful follow-ups for your customer journey.', templates: 'Create, review and test your WhatsApp messages.', campaigns: 'Reach your audience with approved messages.', connect: 'Manage app updates and connect your WhatsApp Business numbers.' }[tab]}</p></div>

            {signupError && (tab === 'channels' || tab === 'connect') && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">{signupError}</div>}

            {tab === 'channels' && <WabaChannels accounts={accounts} busy={saving} onConnect={connectWithMeta}
                onSettings={() => setTab('connect')}
                onSelect={(id) => void run(async () => { await api.post('/accounts/select', { accountId: id }) })} />}

            {tab === 'numbers' && (
                <section className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm font-medium" role="status">{accounts.length ? `Showing ${first + 1}–${Math.min(first + 20, accounts.length)} of ${accounts.length} numbers` : 'No numbers connected'}</p>
                        <button type="button" className={btnClass} onClick={() => setTab('connect')}>Add a number</button>
                    </div>
                    <div className="flex flex-col gap-2">
                        {accounts.slice(first, first + 20).map((item) => (
                            <div key={item.id} className={cn('flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3', item.isSelected ? 'bg-[#00685d] text-white' : 'bg-slate-50 text-slate-700')}>
                                <button type="button" aria-pressed={item.isSelected} disabled={saving} className="min-w-0 flex-1 text-left" onClick={() => run(async () => { await api.post('/accounts/select', { accountId: item.id }) })}>
                                    <p className="truncate text-sm font-semibold">{item.label || item.displayPhone || item.wabaId || 'WhatsApp number'}</p>
                                    <p className={cn('text-xs font-semibold', item.isSelected ? 'text-white/70' : 'text-slate-500')}>
                                        {item.connected ? `${item.displayName || 'Connected'} · ${item.phoneNumberId}` : item.pendingPhone ? 'Phone pending' : 'Not connected — delete if this number was removed in Meta'}
                                    </p>
                                </button>
                                <button
                                    type="button"
                                    className={cn('h-10 rounded-xl px-3 text-xs font-semibold', item.isSelected ? 'bg-white/15 text-white' : 'bg-white text-red-600')}
                                    disabled={saving}
                                    onClick={() => run(async () => {
                                        if (!confirm('Remove this WhatsApp number? Inbox, templates and flows for this number will be deleted here. This does not change Meta if you already deleted it there.')) return
                                        await api.delete(`/accounts/${item.id}`)
                                    })}
                                >
                                    Delete
                                </button>
                            </div>
                        ))}
                    </div>
                    <nav aria-label="Number pages" className="mt-4 flex flex-wrap items-center justify-between gap-2">
                        <button type="button" className={ghostClass} disabled={page === 0} onClick={() => setNumberPage(page - 1)}>Previous</button>
                        <span className="text-sm text-slate-500">Page {page + 1} of {pageCount}</span>
                        <button type="button" className={ghostClass} disabled={page + 1 === pageCount} onClick={() => setNumberPage(page + 1)}>Next</button>
                    </nav>
                </section>
            )}

            {status.nameStatus && status.nameStatus !== 'APPROVED' && (
                <p className="rounded-xl bg-amber-50 p-4 text-sm font-semibold text-amber-900">
                    Display name “{status.displayName || 'this number'}” is {status.nameStatus.replaceAll('_', ' ').toLowerCase()}. WhatsApp keeps a single grey tick and will not deliver chats to this inbox until Meta approves the name. Check WhatsApp Manager → Phone numbers. Then send a new hi.
                </p>
            )}
            {status.canSendMessage === 'BLOCKED' && (
                <p className="rounded-xl bg-rose-50 p-4 text-sm font-semibold text-rose-900">
                    Meta blocked this WABA from sending. {status.healthError || 'Add a payment method in WhatsApp Manager for this WhatsApp Business account.'}
                </p>
            )}

            {tab === 'analytics' && <WabaAnalytics key={status.id} accountId={status.id} />}

            {tab === 'assistant' && <WabaAssistant key={status.id} accountId={status.id} />}

            {tab === 'inbox' && (
                <WabaInbox key={status.id} accounts={accounts} connected={status.connected} templates={templates} accountId={status.id} displayPhone={status.displayPhone} lastWebhookAt={status.lastWebhookAt} lastWebhookFields={status.lastWebhookFields} />
            )}

            {tab === 'flows' && (
                <WabaFlows key={status.id} templates={templates} accountId={status.id} />
            )}

            {tab === 'connect' && <WabaUpdates />}

            {tab === 'connect' && (
                <div className="grid gap-6 lg:grid-cols-2">
                    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
                        <h2 className="text-lg font-semibold text-slate-900">1. Meta app (Embedded Signup v4)</h2>
                        <p className="text-sm text-slate-500">Create a new Facebook Login for Business configuration. Choosing products sets the flow to v4. Do not reuse a v2/v3 config. Graph {status.graphVersion}.</p>
                        <ol className="list-decimal space-y-1 pl-5 text-sm font-medium text-slate-500">
                            <li>App Dashboard → Facebook Login for Business → Settings: turn on Client OAuth, Web OAuth, Enforce HTTPS, Embedded Browser OAuth, Strict Mode, and Login with the JavaScript SDK.</li>
                            <li>Add <span className="font-mono text-slate-800">{redirectUri || 'Your configured admin callback URL'}</span> to Valid OAuth Redirect URIs, and this admin host to Allowed domains.</li>
                            <li>Configurations → Create from template “WhatsApp Embedded Signup Configuration With 60 Expiration Token”, or create one with login variation Embedded Signup and product Cloud API.</li>
                            <li>Request Advanced Access for <span className="font-mono text-slate-800">whatsapp_business_management</span> and <span className="font-mono text-slate-800">whatsapp_business_messaging</span>.</li>
                        </ol>
                        <Field label="Meta App ID">
                            <input className={inputClass} value={settings.metaAppId} onChange={(e) => setSettings({ ...settings, metaAppId: e.target.value })} />
                        </Field>
                        <Field label="v4 configuration ID">
                            <input className={inputClass} value={settings.embeddedSignupConfigId} onChange={(e) => setSettings({ ...settings, embeddedSignupConfigId: e.target.value })} placeholder="Facebook Login for Business configuration ID" />
                        </Field>
                        <Field label="Meta App Secret">
                            <input className={inputClass} type="password" value={settings.metaAppSecret} onChange={(e) => setSettings({ ...settings, metaAppSecret: e.target.value })} placeholder={status.hasAppSecret ? 'Saved — paste to replace' : 'App secret'} />
                        </Field>
                        <button type="button" className={btnClass} disabled={saving} onClick={() => run(async () => { await api.post('/settings', settings) })}>
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save Meta settings'}
                        </button>
                        <div className="rounded-lg bg-slate-50 p-4 text-xs font-semibold text-slate-500">
                            <p>Webhook URL</p>
                            <p className="mt-1 break-all font-mono text-slate-800">{status.webhookUrl || status.webhookSetupError}</p>
                            <p className="mt-2">Verify token</p>
                            <p className="mt-1 break-all font-mono text-slate-800">{status.verifyToken || 'Save settings to generate'}</p>
                            <p className="mt-2">Subscribe to messages, message_template_status_update, and account_update.</p>
                        </div>
                    </section>
                    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
                        <h2 className="text-lg font-semibold text-slate-900">2. Connect with Meta</h2>
                        <p className="text-sm text-slate-500">v4 is phone-number-first. After the popup, this app must register the number on Cloud API. Without that step Meta says the account does not exist and templates stay pending. Finish the popup on desktop Chrome.</p>
                        {status.connected && !status.cloudRegistered && (
                            <p className="rounded-lg bg-amber-50 p-4 text-sm font-semibold text-amber-800">This number is verified but not on Cloud API yet ({status.phoneStatus || 'PENDING'}). Click Register on Cloud API. If two-step verification is already on, use that PIN.</p>
                        )}
                        {status.cloudRegistered && (
                            <p className="rounded-lg bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">Cloud API registered · {status.displayPhone || status.phoneNumberId} · {status.phoneStatus}</p>
                        )}
                        {signupError && <p className="text-sm text-slate-600">If Meta stopped customer onboarding, check the app’s business verification, App Review and Tech Provider access. Save the session ID for Meta support.</p>}
                        <Field label="Cloud API two-step PIN">
                            <input className={inputClass} value={manual.pin} onChange={(e) => setManual({ ...manual, pin: e.target.value })} placeholder="123456" />
                        </Field>
                        <button type="button" className={btnClass} disabled={saving} onClick={connectWithMeta}>{status.connected || accounts.length ? 'Connect another number' : 'Connect with Meta'}</button>
                        <div className="grid gap-3">
                            <Field label="Access token"><input type="password" autoComplete="off" className={inputClass} value={manual.accessToken} onChange={(e) => setManual({ ...manual, accessToken: e.target.value })} /></Field>
                            <Field label="WABA ID"><input className={inputClass} value={manual.wabaId} onChange={(e) => setManual({ ...manual, wabaId: e.target.value })} /></Field>
                            <Field label="Phone number ID"><input className={inputClass} value={manual.phoneNumberId} onChange={(e) => setManual({ ...manual, phoneNumberId: e.target.value })} /></Field>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button type="button" className={ghostClass} disabled={saving} onClick={() => run(async () => { await api.post('/manual', manual) })}>Connect with token</button>
                            <button type="button" className={btnClass} disabled={saving || (!status.connected && !status.pendingPhone)} onClick={() => run(async () => { await api.post('/refresh', { pin: manual.pin, accountId: status.id }) })}>Register on Cloud API</button>
                            <button type="button" className={ghostClass} disabled={saving || (!status.connected && !status.pendingPhone)} onClick={() => run(async () => { await api.post('/refresh', { pin: manual.pin, accountId: status.id }) })}>Refresh</button>
                            <button type="button" className={ghostClass} disabled={saving || (!status.connected && !status.pendingPhone)} onClick={() => run(async () => { if (confirm('Disconnect this WABA?')) await api.post('/disconnect', { accountId: status.id }) })}>Disconnect</button>
                        </div>
                        {(status.connected || status.pendingPhone) && (
                            <p className="text-sm font-semibold text-slate-600">{status.displayName || 'WhatsApp'} · {status.cloudRegistered ? 'Cloud API connected' : `Cloud API ${status.platformType || status.phoneStatus || 'not registered'}`} · quality {status.qualityRating || 'unknown'}{status.businessId ? ` · business ${status.businessId}` : ''}</p>
                        )}
                    </section>
                </div>
            )}

            {tab === 'templates' && (
                <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
                    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
                        <h2 className="text-lg font-semibold text-slate-900">Submit template</h2>
                        <p className="text-sm text-slate-500">Use the same merge tags as email. Meta reviews UTILITY / MARKETING / AUTHENTICATION templates, usually within a day.</p>
                        <Field label="Name"><input className={inputClass} value={templateForm.name} onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })} /></Field>
                        <Field label="Language"><input className={inputClass} value={templateForm.language} onChange={(e) => setTemplateForm({ ...templateForm, language: e.target.value })} /></Field>
                        <Field label="Category">
                            <select className={inputClass} value={templateForm.category} onChange={(e) => setTemplateForm({ ...templateForm, category: e.target.value })}>
                                <option>UTILITY</option>
                                <option>MARKETING</option>
                                <option>AUTHENTICATION</option>
                            </select>
                        </Field>
                        <Field label="Body">
                            <textarea className={cn(inputClass, 'min-h-32')} value={templateForm.body} onChange={(e) => setTemplateForm({ ...templateForm, body: e.target.value })} />
                        </Field>
                        <button type="button" className={btnClass} disabled={saving || !status.connected} onClick={() => run(async () => { await api.post('/templates', templateForm) })}>Submit for approval</button>
                        <button type="button" className={ghostClass} disabled={saving || !status.connected} onClick={() => run(async () => { await api.post('/templates/events') })}>Add 3 test templates</button>
                        <button type="button" className={ghostClass} disabled={saving || !status.connected} onClick={() => run(async () => { await api.post('/templates/sync') })}>Sync from Meta</button>
                    </section>
                    <section className="space-y-3">
                        {templates.map((item) => (
                            <div key={item.id} className="rounded-xl border border-slate-200 bg-white p-5">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p className="font-semibold text-slate-900">{item.name}</p>
                                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{item.status} · {item.category}</span>
                                </div>
                                <p className="mt-2 text-sm text-slate-600">{item.bodyText}</p>
                                {item.rejectionReason ? <p className="mt-2 text-sm font-semibold text-red-600">{item.rejectionReason}</p> : null}
                                <div className="mt-3 flex flex-wrap gap-2">
                                    <input className="min-w-[10rem] flex-1 rounded-xl bg-slate-50 px-3 py-2 text-sm font-semibold" placeholder="Test mobile" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} />
                                    <button type="button" className={ghostClass} disabled={saving || item.status !== 'APPROVED'} onClick={() => run(async () => { await api.post('/test', { templateId: item.id, phone: testPhone }) })}>Test send</button>
                                    <button type="button" className={ghostClass} disabled={saving} onClick={() => run(async () => { if (confirm('Delete local copy of this template?')) await api.delete(`/templates/${item.id}`) })}>Delete</button>
                                </div>
                            </div>
                        ))}
                        {!templates.length && <p className="rounded-xl bg-slate-50 p-8 text-sm font-semibold text-slate-500">No templates yet. Submit one after connecting.</p>}
                    </section>
                </div>
            )}

            {tab === 'campaigns' && (
                <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
                    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
                        <h2 className="text-lg font-semibold text-slate-900">Broadcast</h2>
                        <p className="text-sm text-slate-500">Only APPROVED templates send. Attach the same templates to Email Flows for ORDER_PLACED and other triggers.</p>
                        <Field label="Name"><input className={inputClass} value={campaignForm.name} onChange={(e) => setCampaignForm({ ...campaignForm, name: e.target.value })} /></Field>
                        <Field label="Template">
                            <select className={inputClass} value={campaignForm.templateId} onChange={(e) => setCampaignForm({ ...campaignForm, templateId: e.target.value })}>
                                <option value="">Select approved template</option>
                                {approved.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                            </select>
                        </Field>
                        <Field label="Audience">
                            <select className={inputClass} value={campaignForm.audience} onChange={(e) => setCampaignForm({ ...campaignForm, audience: e.target.value })}>
                                <option value="ORDERS">Order phones</option>
                                <option value="LEADS">Demo leads</option>
                                <option value="BOTH">Orders and leads</option>
                            </select>
                        </Field>
                        <button type="button" className={btnClass} disabled={saving || !campaignForm.templateId} onClick={() => run(async () => {
                            const created = await api.post('/campaigns', campaignForm)
                            if (confirm('Queue this campaign now?')) await api.post(`/campaigns/${created.data.campaign.id}/send`)
                        })}>Create and queue</button>
                        <a href="/admin/email-flows" className="block text-sm font-semibold text-[#00685d]">Open Email Flows to attach WhatsApp templates →</a>
                    </section>
                    <section className="space-y-3">
                        {campaigns.map((item) => (
                            <div key={item.id} className="rounded-xl border border-slate-200 bg-white p-5">
                                <div className="flex items-center justify-between gap-2">
                                    <p className="font-semibold text-slate-900">{item.name}</p>
                                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{item.status}</span>
                                </div>
                                <p className="mt-1 text-sm text-slate-500">{item.template?.name} · {item.audience} · queued {item.queuedCount} · sent {item.sentCount} · failed {item.failedCount}</p>
                                {item.status === 'DRAFT' && (
                                    <button type="button" className={cn(btnClass, 'mt-3')} disabled={saving} onClick={() => run(async () => { await api.post(`/campaigns/${item.id}/send`) })}>Queue send</button>
                                )}
                            </div>
                        ))}
                        <div className="rounded-xl bg-slate-50 p-5">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Recent queue</p>
                            <div className="mt-3 space-y-2">
                                {queue.map((item) => (
                                    <p key={item.id} className="text-sm font-semibold text-slate-600">{item.phone} · {item.templateName} · {item.status}</p>
                                ))}
                                {!queue.length && <p className="text-sm text-slate-400">No queued messages yet.</p>}
                            </div>
                        </div>
                    </section>
                </div>
            )}
                </div>
            </main>
        </div>
    )
}
