'use client'

import { useEffect, useState } from 'react'
import { useWabaApi, wabaErrorMessage } from './WabaHost'
import { ArrowDown, Clock3, Loader2, MessageSquare, Plus, Trash2, Zap } from 'lucide-react'
import { cn } from '../lib/cn'
import { WABA_FLOW_TRIGGERS } from '../lib/wabaTriggers'

const btnClass = 'inline-flex h-11 items-center justify-center rounded-lg bg-[#00685d] px-4 text-sm font-semibold text-white disabled:opacity-50'
const ghostClass = 'inline-flex h-11 items-center justify-center rounded-lg bg-slate-100 px-4 text-sm font-semibold text-slate-700'
const inputClass = 'w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-normal text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600/20'

type Flow = {
    id: string
    name: string
    triggerType: string
    isActive: boolean
    steps: Array<{ id: string; sequenceOrder: number; delayHours: number; templateName: string }>
}

export function WabaFlows({
    templates,
    accountId,
}: {
    templates: Array<{ id: string; name: string; status: string }>
    accountId?: string
}) {
    const api = useWabaApi()
    const [flows, setFlows] = useState<Flow[]>([])
    const [activeId, setActiveId] = useState('')
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [edit, setEdit] = useState({ name: '', triggerType: 'ORDER_PLACED', isActive: false })
    const [form, setForm] = useState({ name: '', triggerType: 'ORDER_PLACED', isActive: false })
    const [stepForm, setStepForm] = useState({ sequenceOrder: 1, delayHours: 0, templateName: '' })
    const approved = templates.filter((item) => String(item.status).toUpperCase() === 'APPROVED')
    const active = flows.find((item) => item.id === activeId) || null
    useEffect(() => {
        if (active) setEdit({ name: active.name, triggerType: active.triggerType, isActive: active.isActive })
        setStepForm({ sequenceOrder: Math.max(0, ...(active?.steps || []).map(step => step.sequenceOrder)) + 1, delayHours: 0, templateName: '' })
    }, [active])
    const triggerLabel = (id: string) => WABA_FLOW_TRIGGERS.find((item) => item.id === id)?.label || id

    const load = async () => {
        const res = await api.get('/flows', { params: { accountId } })
        setFlows(res.data.flows || [])
        return res.data.flows || []
    }

    useEffect(() => {
        setActiveId('')
        load().then((items: Flow[]) => {
            if (items[0]) setActiveId(items[0].id)
        }).catch((error) => alert(wabaErrorMessage(error, 'Could not load WhatsApp flows'))).finally(() => setLoading(false))
    }, [accountId])

    const run = async (work: () => Promise<void>) => {
        setSaving(true)
        try {
            await work()
            const items = await load()
            if (activeId && !items.some((item: Flow) => item.id === activeId)) setActiveId(items[0]?.id || '')
        } catch (error: any) {
            alert(wabaErrorMessage(error, 'WhatsApp flow request failed'))
        } finally {
            setSaving(false)
        }
    }

    if (loading) {
        return <div className="flex min-h-[30vh] items-center justify-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
    }

    return (
        <div className="grid gap-6 xl:grid-cols-[19rem_minmax(0,1fr)]">
            <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
                <h2 className="text-lg font-semibold text-slate-900">Event flows</h2>
                <p className="text-sm text-slate-500">Create an automation for an event from your host app. Add approved templates and delays in the workflow builder.</p>
                <input className={inputClass} placeholder="Flow name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                <select className={inputClass} value={form.triggerType} onChange={(e) => setForm({ ...form, triggerType: e.target.value })}>
                    {WABA_FLOW_TRIGGERS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
                <p className="text-xs font-semibold text-slate-500">{WABA_FLOW_TRIGGERS.find((item) => item.id === form.triggerType)?.description}</p>
                <label className="flex items-center gap-3 rounded-lg bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700">
                    <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
                    Active
                </label>
                <button type="button" className={btnClass} disabled={saving || !form.name.trim()} onClick={() => run(async () => {
                    const created = await api.post('/flows', { ...form, accountId })
                    setActiveId(created.data.flow.id)
                    setForm({ name: '', triggerType: 'ORDER_PLACED', isActive: false })
                })}>
                    <Plus className="mr-2 h-4 w-4" /> Create flow
                </button>
                <div className="space-y-2">
                    {flows.map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            onClick={() => {
                                setActiveId(item.id)
                            }}
                            className={cn('w-full rounded-lg px-4 py-3 text-left', activeId === item.id ? 'bg-[#00685d] text-white' : 'bg-slate-50 text-slate-700')}
                        >
                            <p className="text-sm font-semibold">{item.name}</p>
                            <p className={cn('text-xs font-semibold', activeId === item.id ? 'text-white/70' : 'text-slate-500')}>{triggerLabel(item.triggerType)} · {item.isActive ? 'Active' : 'Paused'} · {item.steps.length} steps</p>
                        </button>
                    ))}
                    {!flows.length && <p className="text-sm font-semibold text-slate-400">No WhatsApp flows yet.</p>}
                </div>
            </section>
            <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
                {active ? (
                    <>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <h2 className="text-lg font-semibold text-slate-900">{active.name}</h2>
                                <p className="text-sm font-semibold text-slate-500">{triggerLabel(active.triggerType)}</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <button type="button" className={ghostClass} disabled={saving || !edit.name.trim()} onClick={() => run(async () => {
                                    await api.put(`/flows/${active.id}`, edit)
                                })}>Save</button>
                                <button type="button" className={ghostClass} disabled={saving} onClick={() => run(async () => {
                                    if (!confirm('Delete this WhatsApp flow?')) return
                                    await api.delete(`/flows/${active.id}`)
                                })}><Trash2 className="h-4 w-4" /></button>
                            </div>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <label className="space-y-1 text-xs font-semibold">Workflow name<input className={inputClass} value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} /></label>
                            <label className="space-y-1 text-xs font-semibold">Trigger<select className={inputClass} value={edit.triggerType} onChange={e => setEdit({ ...edit, triggerType: e.target.value })}>
                                {WABA_FLOW_TRIGGERS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                            </select></label>
                            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.isActive} onChange={e => setEdit({ ...edit, isActive: e.target.checked })} /> Active workflow</label>
                        </div>
                        <div className="space-y-2 rounded-xl border border-slate-200 bg-[#f7f9fc] p-4">
                            <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-white p-3 text-sm"><Zap size={17} className="text-emerald-700" /><div><p className="text-xs text-slate-500">Trigger</p><strong>{triggerLabel(active.triggerType)}</strong></div></div>
                            {active.steps.map(step => <div key={step.id}>
                                <ArrowDown size={16} className="mx-auto my-2 text-slate-400" />
                                <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm">
                                    <MessageSquare size={17} className="shrink-0 text-indigo-600" />
                                    <div className="min-w-0 flex-1"><p className="flex items-center gap-1 text-xs text-slate-500"><Clock3 size={12} />{step.delayHours ? `After ${step.delayHours} hours` : 'Immediately'}</p><p className="break-words font-semibold">{step.templateName}</p></div>
                                    <button type="button" aria-label={`Delete step ${step.sequenceOrder}`} className={ghostClass} disabled={saving} onClick={() => run(async () => {
                                        if (confirm('Delete this step?')) await api.delete(`/flow-steps/${step.id}`)
                                    })}><Trash2 size={16} /></button>
                                </div>
                            </div>)}
                            {!active.steps.length && <p className="p-3 text-sm text-slate-500">Add your first message step below.</p>}
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[5rem_6rem_minmax(0,1fr)_auto]">
                            <input aria-label="Step order" className={inputClass} type="number" min={1} value={stepForm.sequenceOrder} onChange={(e) => setStepForm({ ...stepForm, sequenceOrder: Number(e.target.value) })} />
                            <input aria-label="Delay in hours" className={inputClass} type="number" min={0} value={stepForm.delayHours} onChange={(e) => setStepForm({ ...stepForm, delayHours: Number(e.target.value) })} />
                            <select aria-label="Step template" className={inputClass} value={stepForm.templateName} onChange={(e) => setStepForm({ ...stepForm, templateName: e.target.value })}>
                                <option value="">Approved template</option>
                                {approved.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
                            </select>
                            <button type="button" className={btnClass} disabled={saving || !stepForm.templateName} onClick={() => run(async () => {
                                await api.post(`/flows/${active.id}/steps`, stepForm)
                                setStepForm({ sequenceOrder: active.steps.length + 2, delayHours: 0, templateName: '' })
                            })}>Add step</button>
                        </div>
                        <p className="text-xs font-semibold text-slate-400">Order · delay hours · template. Delay 0 sends immediately on the event.</p>
                    </>
                ) : (
                    <p className="p-8 text-sm font-semibold text-slate-400">Create a flow, then attach approved templates to the event.</p>
                )}
            </section>
        </div>
    )
}
