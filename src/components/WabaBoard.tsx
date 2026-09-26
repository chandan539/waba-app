'use client'

import { useEffect, useRef, useState } from 'react'
import axios from 'axios'
import { Loader2 } from 'lucide-react'
import { cn } from '../lib/cn'
import { WABA_GRAPH_VERSION, embeddedSignupDialogUrl, isFacebookMessageOrigin, parseEmbeddedSignupMessage, wabaOauthRedirectUri } from '../lib/wabaSignup'
import { WABA_FEATURE_PAUSED } from '../lib/wabaFlags'
import { WabaInbox } from './WabaInbox'
import { WabaFlows } from './WabaFlows'

type Tab = 'inbox' | 'flows' | 'connect' | 'templates' | 'campaigns'
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
    lastWebhookAt: null,
    lastWebhookFields: '',
    graphVersion: WABA_GRAPH_VERSION,
    embeddedSignupVersion: 'v4',
}

const TABS: { id: Tab; label: string }[] = [
    { id: 'inbox', label: 'Inbox' },
    { id: 'flows', label: 'Flows' },
    { id: 'templates', label: 'Templates' },
    { id: 'campaigns', label: 'Campaigns' },
    { id: 'connect', label: 'Connect Meta' },
]

const inputClass = 'w-full rounded-2xl bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900'
const btnClass = 'inline-flex h-11 items-center justify-center rounded-2xl bg-[#001a72] px-4 text-sm font-black text-white disabled:opacity-50'
const ghostClass = 'inline-flex h-11 items-center justify-center rounded-2xl bg-slate-100 px-4 text-sm font-black text-slate-700'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="grid gap-1 text-xs font-black uppercase tracking-widest text-slate-400">
            {label}
            {children}
        </label>
    )
}

export function WabaBoard() {
    const [tab, setTab] = useState<Tab>('inbox')
    const [status, setStatus] = useState<Status>(emptyStatus)
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
    const signupSession = useRef({ wabaId: '', phoneNumberId: '', businessId: '', event: '', cancelled: false, currentStep: '', errorMessage: '' })

    const load = async () => {
        const res = await axios.get('/api/admin/waba')
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
            const oauthReturn = Boolean(params.get('code') || params.get('error') || params.get('error_description'))
            const isPopup = Boolean(window.opener && window.opener !== window)
            if (oauthReturn && isPopup) {
                setLoading(false)
                return
            }
        }
        load().catch((error) => alert(error.response?.data?.error || 'Could not load WABA')).finally(() => setLoading(false))
    }, [])

    useEffect(() => {
        const onMessage = (event: MessageEvent) => {
            if (!isFacebookMessageOrigin(event.origin)) return
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
            }
            if (parsed.finished && typeof window !== 'undefined') {
                sessionStorage.setItem('waba_es_session', JSON.stringify({
                    wabaId: parsed.wabaId,
                    phoneNumberId: parsed.phoneNumberId,
                    businessId: parsed.businessId,
                }))
            }
        }
        window.addEventListener('message', onMessage)
        return () => window.removeEventListener('message', onMessage)
    }, [])

    const exchangeCode = async (code: string) => {
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
        const pin = manual.pin || (typeof window !== 'undefined' ? sessionStorage.getItem('waba_pin') || '' : '')
        const redirectUri = wabaOauthRedirectUri(typeof window !== 'undefined' ? window.location.origin : undefined)
        await axios.post('/api/admin/waba/embedded-signup', {
            code,
            wabaId: session.wabaId,
            phoneNumberId: session.phoneNumberId,
            businessId: session.businessId,
            pin,
            redirectUri,
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
        if (!code && !error) return
        window.history.replaceState({}, '', '/admin/waba')
        if (error) {
            alert(error)
            return
        }
        if (window.opener && window.opener !== window) {
            window.opener.postMessage({ type: 'WABA_OAUTH_CODE', code }, window.location.origin)
            window.close()
            return
        }
        run(async () => { await exchangeCode(code!) })
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

    const connectWithMeta = async () => {
        let configId = String(status.embeddedSignupConfigId || settings.embeddedSignupConfigId || '').trim()
        let appId = String(status.metaAppId || settings.metaAppId || '').trim()
        if (!appId || !configId) {
            try {
                const res = await axios.get('/api/admin/waba')
                const next = res.data.status || {}
                setStatus({ ...emptyStatus, ...next })
                setAccounts(next.accounts || [])
                setSettings((prev) => ({
                    ...prev,
                    metaAppId: next.metaAppId || prev.metaAppId,
                    embeddedSignupConfigId: next.embeddedSignupConfigId || prev.embeddedSignupConfigId,
                }))
                appId = String(next.metaAppId || settings.metaAppId || '').trim()
                configId = String(next.embeddedSignupConfigId || settings.embeddedSignupConfigId || '').trim()
            } catch {
                // Keep local values if the refresh fails.
            }
        }
        if (!appId || !configId) {
            setTab('connect')
            alert('Save Meta App ID and a v4 Embedded Signup configuration ID first')
            return
        }
        signupSession.current = { wabaId: '', phoneNumberId: '', businessId: '', event: '', cancelled: false, currentStep: '', errorMessage: '' }
        const redirectUri = wabaOauthRedirectUri(window.location.origin)
        const url = embeddedSignupDialogUrl({ appId, configId, redirectUri })
        if (!url.includes(`config_id=${configId}`) || !url.includes('response_type=code')) {
            alert('Could not build the Embedded Signup URL. Recheck the configuration ID.')
            return
        }
        sessionStorage.setItem('waba_pin', manual.pin || '')
        const popup = window.open(url, 'fb_waba_es', 'width=620,height=780,scrollbars=yes')
        if (!popup) {
            window.location.href = url
            return
        }
        const timer = window.setInterval(() => {
            if (popup.closed) {
                window.clearInterval(timer)
                return
            }
            try {
                const popupUrl = new URL(popup.location.href)
                if (popupUrl.origin !== window.location.origin) return
                const code = popupUrl.searchParams.get('code')
                const error = popupUrl.searchParams.get('error_description') || popupUrl.searchParams.get('error')
                popup.close()
                window.clearInterval(timer)
                if (code) run(async () => { await exchangeCode(code) })
                else alert(error || 'Meta did not return an authorization code. The Facebook URL must include config_id and response_type=code. Recreate the configuration as WhatsApp Embedded Signup, or use Connect with token.')
            } catch {
                // Still on facebook.com until redirect.
            }
        }, 400)
        const onOpenerMessage = (event: MessageEvent) => {
            if (event.origin !== window.location.origin) return
            if (event.data?.type !== 'WABA_OAUTH_CODE' || !event.data?.code) return
            window.clearInterval(timer)
            window.removeEventListener('message', onOpenerMessage)
            try { popup.close() } catch {}
            run(async () => { await exchangeCode(String(event.data.code)) })
        }
        window.addEventListener('message', onOpenerMessage)
    }

    if (WABA_FEATURE_PAUSED) {
        return (
            <div className="space-y-4">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Marketing</p>
                <h1 className="font-outfit text-3xl font-black text-slate-900">WhatsApp <span className="text-blue-600">WABA</span></h1>
                <p className="max-w-xl rounded-[1.5rem] bg-amber-50 p-6 text-sm font-semibold text-amber-900">
                    WhatsApp WABA is paused. Inbox polling, campaigns, and event flows are off so they do not hit the database. Connected numbers and templates stay saved. Say when you want this turned back on.
                </p>
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

    const approved = templates.filter((item) => String(item.status).toUpperCase() === 'APPROVED')

    return (
        <div className="space-y-8">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Marketing</p>
                    <h1 className="font-outfit text-3xl font-black text-slate-900">WhatsApp <span className="text-blue-600">WABA</span></h1>
                    <p className="mt-1 text-sm font-medium text-slate-500">Inbox for customer WhatsApp, event flows like email, templates, and broadcasts.</p>
                </div>
                <div className={cn('rounded-2xl px-4 py-3 text-sm font-black', status.connected ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>
                    {status.connected ? `Connected ${status.displayPhone || status.wabaId}${status.cloudRegistered ? ' · Cloud API' : ' · not on Cloud API'}` : status.pendingPhone ? 'WABA linked — add a phone number' : 'Not connected'}
                </div>
            </div>

            {accounts.length > 0 && (
                <section className="rounded-[2rem] border border-slate-100 bg-white p-4">
                    <p className="mb-3 text-xs font-black uppercase tracking-widest text-slate-400">WhatsApp numbers</p>
                    <div className="flex flex-col gap-2">
                        {accounts.map((item) => (
                            <div key={item.id} className={cn('flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3', item.isSelected ? 'bg-[#001a72] text-white' : 'bg-slate-50 text-slate-700')}>
                                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => run(async () => { await axios.post('/api/admin/waba/accounts/select', { accountId: item.id }) })}>
                                    <p className="truncate text-sm font-black">{item.label || item.displayPhone || item.wabaId || 'WhatsApp number'}</p>
                                    <p className={cn('text-xs font-semibold', item.isSelected ? 'text-white/70' : 'text-slate-500')}>
                                        {item.connected ? `${item.displayName || 'Connected'} · ${item.phoneNumberId}` : item.pendingPhone ? 'Phone pending' : 'Not connected — delete if this number was removed in Meta'}
                                    </p>
                                </button>
                                <button
                                    type="button"
                                    className={cn('h-10 rounded-xl px-3 text-xs font-black', item.isSelected ? 'bg-white/15 text-white' : 'bg-white text-red-600')}
                                    disabled={saving}
                                    onClick={() => run(async () => {
                                        if (!confirm('Remove this WhatsApp number? Inbox, templates and flows for this number will be deleted here. This does not change Meta if you already deleted it there.')) return
                                        await axios.delete(`/api/admin/waba/accounts/${item.id}`)
                                    })}
                                >
                                    Delete
                                </button>
                            </div>
                        ))}
                    </div>
                    <p className="mt-3 text-xs font-semibold text-slate-500">Select a number to see its inbox, flows and templates. Connect with Meta again to add another number.</p>
                </section>
            )}

            {status.nameStatus && status.nameStatus !== 'APPROVED' && (
                <p className="rounded-[1.5rem] bg-amber-50 p-4 text-sm font-semibold text-amber-900">
                    Display name “{status.displayName || 'this number'}” is {status.nameStatus.replaceAll('_', ' ').toLowerCase()}. WhatsApp keeps a single grey tick and will not deliver chats to this inbox until Meta approves the name. Check WhatsApp Manager → Phone numbers. Then send a new hi.
                </p>
            )}
            {status.canSendMessage === 'BLOCKED' && (
                <p className="rounded-[1.5rem] bg-rose-50 p-4 text-sm font-semibold text-rose-900">
                    Meta blocked this WABA from sending. {status.healthError || 'Add a payment method in WhatsApp Manager for this WhatsApp Business account.'}
                </p>
            )}

            <div className="flex flex-wrap gap-2">
                {TABS.map((item) => (
                    <button
                        key={item.id}
                        type="button"
                        onClick={() => setTab(item.id)}
                        className={cn(
                            'h-11 rounded-2xl px-4 text-sm font-black',
                            tab === item.id ? 'bg-[#001a72] text-white' : 'bg-slate-100 text-slate-600',
                        )}
                    >
                        {item.label}
                    </button>
                ))}
            </div>

            {tab === 'inbox' && (
                <WabaInbox connected={status.connected} templates={templates} accountId={status.id} displayPhone={status.displayPhone} lastWebhookAt={status.lastWebhookAt} lastWebhookFields={status.lastWebhookFields} />
            )}

            {tab === 'flows' && (
                <WabaFlows templates={templates} accountId={status.id} />
            )}

            {tab === 'connect' && (
                <div className="grid gap-6 lg:grid-cols-2">
                    <section className="space-y-4 rounded-[2rem] border border-slate-100 bg-white p-6">
                        <h2 className="text-lg font-black text-slate-900">1. Meta app (Embedded Signup v4)</h2>
                        <p className="text-sm text-slate-500">Create a new Facebook Login for Business configuration. Choosing products sets the flow to v4. Do not reuse a v2/v3 config. Graph {status.graphVersion}.</p>
                        <ol className="list-decimal space-y-1 pl-5 text-sm font-medium text-slate-500">
                            <li>App Dashboard → Facebook Login for Business → Settings: turn on Client OAuth, Web OAuth, Enforce HTTPS, Embedded Browser OAuth, Strict Mode, and Login with the JavaScript SDK.</li>
                            <li>Add <span className="font-mono text-slate-800">{typeof window !== 'undefined' ? `${window.location.origin}/admin/waba` : 'https://admin.example.com/admin/waba'}</span> to Valid OAuth Redirect URIs, and this admin host to Allowed domains.</li>
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
                        <button type="button" className={btnClass} disabled={saving} onClick={() => run(async () => { await axios.post('/api/admin/waba/settings', settings) })}>
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save Meta settings'}
                        </button>
                        <div className="rounded-2xl bg-slate-50 p-4 text-xs font-semibold text-slate-500">
                            <p>Webhook URL</p>
                            <p className="mt-1 break-all font-mono text-slate-800">{status.webhookUrl}</p>
                            <p className="mt-2">Verify token</p>
                            <p className="mt-1 break-all font-mono text-slate-800">{status.verifyToken || 'Save settings to generate'}</p>
                            <p className="mt-2">Subscribe to messages, message_template_status_update, and account_update.</p>
                        </div>
                    </section>
                    <section className="space-y-4 rounded-[2rem] border border-slate-100 bg-white p-6">
                        <h2 className="text-lg font-black text-slate-900">2. Connect with Meta</h2>
                        <p className="text-sm text-slate-500">v4 is phone-number-first. After the popup, this app must register the number on Cloud API. Without that step Meta says the account does not exist and templates stay pending. Finish the popup on desktop Chrome.</p>
                        {status.connected && !status.cloudRegistered && (
                            <p className="rounded-2xl bg-amber-50 p-4 text-sm font-semibold text-amber-800">This number is verified but not on Cloud API yet ({status.phoneStatus || 'PENDING'}). Click Register on Cloud API. If two-step verification is already on, use that PIN.</p>
                        )}
                        {status.cloudRegistered && (
                            <p className="rounded-2xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">Cloud API registered · {status.displayPhone || status.phoneNumberId} · {status.phoneStatus}</p>
                        )}
                        <Field label="Cloud API two-step PIN">
                            <input className={inputClass} value={manual.pin} onChange={(e) => setManual({ ...manual, pin: e.target.value })} placeholder="123456" />
                        </Field>
                        <button type="button" className={btnClass} disabled={saving} onClick={connectWithMeta}>{status.connected || accounts.length ? 'Connect another number' : 'Connect with Meta'}</button>
                        <div className="grid gap-3">
                            <Field label="Access token"><input className={inputClass} value={manual.accessToken} onChange={(e) => setManual({ ...manual, accessToken: e.target.value })} /></Field>
                            <Field label="WABA ID"><input className={inputClass} value={manual.wabaId} onChange={(e) => setManual({ ...manual, wabaId: e.target.value })} /></Field>
                            <Field label="Phone number ID"><input className={inputClass} value={manual.phoneNumberId} onChange={(e) => setManual({ ...manual, phoneNumberId: e.target.value })} /></Field>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button type="button" className={ghostClass} disabled={saving} onClick={() => run(async () => { await axios.post('/api/admin/waba/manual', manual) })}>Connect with token</button>
                            <button type="button" className={btnClass} disabled={saving || (!status.connected && !status.pendingPhone)} onClick={() => run(async () => { await axios.post('/api/admin/waba/refresh', { pin: manual.pin, accountId: status.id }) })}>Register on Cloud API</button>
                            <button type="button" className={ghostClass} disabled={saving || (!status.connected && !status.pendingPhone)} onClick={() => run(async () => { await axios.post('/api/admin/waba/refresh', { pin: manual.pin, accountId: status.id }) })}>Refresh</button>
                            <button type="button" className={ghostClass} disabled={saving || (!status.connected && !status.pendingPhone)} onClick={() => run(async () => { if (confirm('Disconnect this WABA?')) await axios.post('/api/admin/waba/disconnect', { accountId: status.id }) })}>Disconnect</button>
                        </div>
                        {(status.connected || status.pendingPhone) && (
                            <p className="text-sm font-semibold text-slate-600">{status.displayName || 'WhatsApp'} · {status.cloudRegistered ? 'Cloud API connected' : `Cloud API ${status.platformType || status.phoneStatus || 'not registered'}`} · quality {status.qualityRating || 'unknown'}{status.businessId ? ` · business ${status.businessId}` : ''}</p>
                        )}
                    </section>
                </div>
            )}

            {tab === 'templates' && (
                <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
                    <section className="space-y-4 rounded-[2rem] border border-slate-100 bg-white p-6">
                        <h2 className="text-lg font-black text-slate-900">Submit template</h2>
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
                        <button type="button" className={btnClass} disabled={saving || !status.connected} onClick={() => run(async () => { await axios.post('/api/admin/waba/templates', templateForm) })}>Submit for approval</button>
                        <button type="button" className={ghostClass} disabled={saving || !status.connected} onClick={() => run(async () => { await axios.post('/api/admin/waba/templates/events') })}>Submit all event templates</button>
                        <button type="button" className={ghostClass} disabled={saving || !status.connected} onClick={() => run(async () => { await axios.post('/api/admin/waba/templates/sync') })}>Sync from Meta</button>
                    </section>
                    <section className="space-y-3">
                        {templates.map((item) => (
                            <div key={item.id} className="rounded-[1.5rem] border border-slate-100 bg-white p-5">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p className="font-black text-slate-900">{item.name}</p>
                                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{item.status} · {item.category}</span>
                                </div>
                                <p className="mt-2 text-sm text-slate-600">{item.bodyText}</p>
                                {item.rejectionReason ? <p className="mt-2 text-sm font-semibold text-red-600">{item.rejectionReason}</p> : null}
                                <div className="mt-3 flex flex-wrap gap-2">
                                    <input className="min-w-[10rem] flex-1 rounded-xl bg-slate-50 px-3 py-2 text-sm font-semibold" placeholder="Test mobile" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} />
                                    <button type="button" className={ghostClass} disabled={saving || item.status !== 'APPROVED'} onClick={() => run(async () => { await axios.post('/api/admin/waba/test', { templateId: item.id, phone: testPhone }) })}>Test send</button>
                                    <button type="button" className={ghostClass} disabled={saving} onClick={() => run(async () => { if (confirm('Delete local copy of this template?')) await axios.delete(`/api/admin/waba/templates/${item.id}`) })}>Delete</button>
                                </div>
                            </div>
                        ))}
                        {!templates.length && <p className="rounded-[1.5rem] bg-slate-50 p-8 text-sm font-semibold text-slate-500">No templates yet. Submit one after connecting.</p>}
                    </section>
                </div>
            )}

            {tab === 'campaigns' && (
                <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
                    <section className="space-y-4 rounded-[2rem] border border-slate-100 bg-white p-6">
                        <h2 className="text-lg font-black text-slate-900">Broadcast</h2>
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
                            const created = await axios.post('/api/admin/waba/campaigns', campaignForm)
                            if (confirm('Queue this campaign now?')) await axios.post(`/api/admin/waba/campaigns/${created.data.campaign.id}/send`)
                        })}>Create and queue</button>
                        <a href="/admin/email-flows" className="block text-sm font-black text-[#001a72]">Open Email Flows to attach WhatsApp templates →</a>
                    </section>
                    <section className="space-y-3">
                        {campaigns.map((item) => (
                            <div key={item.id} className="rounded-[1.5rem] border border-slate-100 bg-white p-5">
                                <div className="flex items-center justify-between gap-2">
                                    <p className="font-black text-slate-900">{item.name}</p>
                                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{item.status}</span>
                                </div>
                                <p className="mt-1 text-sm text-slate-500">{item.template?.name} · {item.audience} · queued {item.queuedCount} · sent {item.sentCount} · failed {item.failedCount}</p>
                                {item.status === 'DRAFT' && (
                                    <button type="button" className={cn(btnClass, 'mt-3')} disabled={saving} onClick={() => run(async () => { await axios.post(`/api/admin/waba/campaigns/${item.id}/send`) })}>Queue send</button>
                                )}
                            </div>
                        ))}
                        <div className="rounded-[1.5rem] bg-slate-50 p-5">
                            <p className="text-xs font-black uppercase tracking-widest text-slate-400">Recent queue</p>
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
    )
}
