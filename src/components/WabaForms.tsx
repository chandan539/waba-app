'use client'

import { useEffect, useState, type FormEvent } from 'react'
import type { WhatsAppForm } from '../lib/wabaForms'
import { useWabaApi } from './WabaHost'

const field = 'w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2'
const button = 'rounded-lg bg-[#00685d] px-4 py-2 font-semibold text-white disabled:opacity-50'
const secondary = 'rounded-lg border border-slate-200 px-3 py-2 font-medium disabled:opacity-50'
const panel = 'space-y-4 rounded-xl border border-slate-200 bg-white p-5'
const initial = { name: '', destination: { kind: 'contacts', formId: '' }, fields: [
    { label: 'Email', type: 'email', required: true, target: 'email' },
] }
type Draft = typeof initial
type Status = {
    forms: WhatsAppForm[]
    hubspot: { configured: boolean; portalId: string }
    deliveries: { id: string; formId: string; status: string; error?: string; createdAt: string }[]
}

export function WabaForms({ accountId, connected, callback }: { accountId: string; connected: boolean; callback: boolean }) {
    const api = useWabaApi()
    const [data, setData] = useState<Status>()
    const [draft, setDraft] = useState<Draft>(initial)
    const [editing, setEditing] = useState('')
    const [phone, setPhone] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [notice, setNotice] = useState('')
    const load = async () => {
        const result = await api.get<Status>('/forms', { params: { accountId } })
        setData(result.data)
    }
    function report(err: any) {
        setError(err.response?.data?.error || err.message || 'Forms request failed.')
    }
    async function run(work: () => Promise<unknown>, success: string) {
        setBusy(true)
        setError('')
        setNotice('')
        try { await work(); await load(); setNotice(success) }
        catch (err) { report(err) }
        finally { setBusy(false) }
    }
    useEffect(() => {
        if (!callback) { void load().catch(report); return }
        const url = new URL(window.location.href)
        if (!url.searchParams.has('wabix_hubspot')) { void load().catch(report); return }
        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')
        const denied = url.searchParams.get('error')
        for (const key of ['wabix_hubspot', 'code', 'state', 'error', 'error_description']) url.searchParams.delete(key)
        window.history.replaceState(window.history.state, '', url)
        if (!code || !state || denied) {
            setError('HubSpot authorization was cancelled or did not complete.')
            void load().catch(report)
            return
        }
        void run(() => api.post('/forms/hubspot/complete', { code, state }), 'HubSpot connected.')
    }, [accountId])
    async function connect() {
        setBusy(true)
        setError('')
        try {
            const { data } = await api.post<{ url: string }>('/forms/hubspot/start')
            window.location.assign(data.url)
        } catch (err) { report(err); setBusy(false) }
    }
    function save(event: FormEvent) {
        event.preventDefault()
        void run(async () => {
            const payload = { ...draft, accountId }
            if (editing) await api.put(`/forms/${editing}`, payload)
            else await api.post('/forms', payload)
            setEditing('')
            setDraft(initial)
        }, 'Draft saved.')
    }
    return <div className="space-y-5 text-sm">
        {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-rose-800">{error}</p>}
        {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-emerald-800">{notice}</p>}
        <section className={panel}>
            <h2 className="text-lg font-semibold">HubSpot connection</h2>
            <p>{data?.hubspot.portalId ? `Connected to portal ${data.hubspot.portalId}` : 'Authorize Wabix to deliver form answers to HubSpot.'}</p>
            <button type="button" className={button} disabled={busy || !data?.hubspot.configured} onClick={connect}>
                {data?.hubspot.portalId ? 'Reconnect HubSpot' : 'Connect HubSpot'}
            </button>
            {data && !data.hubspot.configured && <p className="text-slate-600">HubSpot OAuth needs to be configured on this Wabix installation.</p>}
        </section>
        <form className={panel} onSubmit={save}>
            <h2 className="text-lg font-semibold">{editing ? 'Edit draft' : 'Create form'}</h2>
            {!connected && <p>Choose a connected WhatsApp account in the workspace dropdown.</p>}
            <label className="block">Form name<input className={field} required maxLength={80} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
            <label className="block">Destination<select className={field} value={draft.destination.kind} onChange={e => setDraft({ ...draft, destination: { ...draft.destination, kind: e.target.value } })}>
                <option value="contacts">HubSpot contact</option><option value="hubspot-form">HubSpot form</option><option value="webhook">Server-configured webhook</option>
            </select></label>
            {draft.destination.kind === 'hubspot-form' && <label className="block">HubSpot form ID<input className={field} required value={draft.destination.formId} onChange={e => setDraft({ ...draft, destination: { ...draft.destination, formId: e.target.value } })} /></label>}
            {draft.fields.map((item, index) => {
                const change = (value: Partial<typeof item>) => setDraft({ ...draft, fields: draft.fields.map((entry, i) => i === index ? { ...entry, ...value } : entry) })
                return <fieldset key={index} className="grid items-end gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-3">
                    <legend className="px-1 font-medium">Field {index + 1}</legend>
                    <label>Label<input className={field} required maxLength={20} value={item.label} onChange={e => change({ label: e.target.value })} /></label>
                    <label>Type<select className={field} value={item.type} onChange={e => change({ type: e.target.value })}><option value="text">Text</option><option value="email">Email</option><option value="phone">Phone</option></select></label>
                    <label>Destination key<input className={field} required pattern="[a-z][a-z0-9_]{0,63}" value={item.target} onChange={e => change({ target: e.target.value })} /></label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={item.required} onChange={e => change({ required: e.target.checked })} /> Required</label>
                    <button type="button" className={secondary} disabled={draft.fields.length === 1} onClick={() => setDraft({ ...draft, fields: draft.fields.filter((_, i) => i !== index) })}>Remove field</button>
                </fieldset>
            })}
            <div className="flex flex-wrap gap-2">
                <button type="button" className={secondary} disabled={draft.fields.length >= 10} onClick={() => setDraft({ ...draft, fields: [...draft.fields, { label: '', target: '', type: 'text', required: false }] })}>Add field</button>
                <button className={button} disabled={busy || !connected}>Save draft</button>
                {editing && <button type="button" className={secondary} onClick={() => { setDraft(initial); setEditing('') }}>Cancel edit</button>}
            </div>
        </form>
        <section className={panel}>
            <h2 className="text-lg font-semibold">Saved forms</h2>
            <label className="block">Recipient WhatsApp number<input className={field} type="tel" value={phone} onChange={e => setPhone(e.target.value)} /></label>
            <p className="text-slate-600">Ask your test recipient to message your WhatsApp number first to open the 24-hour reply window.</p>
            {!data?.forms.length && <p>No saved forms for this account.</p>}
            {data?.forms.map(form => <div key={form.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3">
                <p><strong>{form.name}</strong> · {form.published ? 'Published' : 'Draft'}</p>
                <div className="flex flex-wrap gap-2">
                    {!form.metaFlowId && <button type="button" className={secondary} disabled={busy} onClick={() => {
                        setEditing(form.id)
                        setDraft({ name: form.name, fields: form.fields, destination: { ...form.destination, formId: form.destination.formId || '' } })
                    }}>Edit draft</button>}
                    {!form.published ? <button type="button" className={button} disabled={busy || !connected} onClick={() => void run(() => api.post(`/forms/${form.id}/publish`, { accountId }), 'Form published to Meta.')}>Publish</button>
                        : <button type="button" className={button} disabled={busy || !connected || !phone.trim()} onClick={() => void run(() => api.post(`/forms/${form.id}/send`, { accountId, phone }), 'Form sent.')}>Send form</button>}
                </div>
            </div>)}
        </section>
        <section className={panel}>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">Recent deliveries</h2>
                <button type="button" className={secondary} disabled={busy} onClick={() => void load().catch(report)}>Refresh</button>
            </div>
            {!data?.deliveries.length && <p>No submissions yet.</p>}
            {data?.deliveries.map(item => <p key={item.id}>
                {data.forms.find(form => form.id === item.formId)?.name || 'WhatsApp form'} · {item.status === 'DONE' ? 'Delivered' : item.status.toLowerCase()} · {new Date(item.createdAt).toLocaleString()} {item.error && <span className="text-rose-700">{item.error}</span>}
            </p>)}
        </section>
    </div>
}
