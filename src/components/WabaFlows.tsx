'use client'

import { useEffect, useState } from 'react'
import axios from 'axios'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { cn } from '../lib/cn'
import { WABA_FLOW_TRIGGERS } from '../lib/waba'

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
    const [flows, setFlows] = useState<Flow[]>([])
    const [activeId, setActiveId] = useState('')
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [form, setForm] = useState({ name: '', triggerType: 'ORDER_PLACED', isActive: false })
    const [stepForm, setStepForm] = useState({ sequenceOrder: 1, delayHours: 0, templateName: '' })
    const approved = templates.filter((item) => String(item.status).toUpperCase() === 'APPROVED')
    const active = flows.find((item) => item.id === activeId) || null
    const triggerLabel = (id: string) => WABA_FLOW_TRIGGERS.find((item) => item.id === id)?.label || id

    const load = async () => {
        const res = await axios.get('/api/admin/waba/flows', { params: { accountId } })
        setFlows(res.data.flows || [])
        return res.data.flows || []
    }

    useEffect(() => {
        setActiveId('')
        load().then((items: Flow[]) => {
            if (items[0]) setActiveId(items[0].id)
        }).catch((error) => alert(error.response?.data?.error || 'Could not load WhatsApp flows')).finally(() => setLoading(false))
    }, [accountId])

    const run = async (work: () => Promise<void>) => {
        setSaving(true)
        try {
            await work()
            const items = await load()
            if (activeId && !items.some((item: Flow) => item.id === activeId)) setActiveId(items[0]?.id || '')
        } catch (error: any) {
            alert(error.response?.data?.error || error.message || 'WhatsApp flow request failed')
        } finally {
            setSaving(false)
        }
    }

    if (loading) {
        return <div className="flex min-h-[30vh] items-center justify-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
    }

    return (
        <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
            <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
                <h2 className="text-lg font-semibold text-slate-900">Event flows</h2>
                <p className="text-sm text-slate-500">Same triggers as Email Flows. When the event fires and a phone is on the order or lead, these approved templates send on WhatsApp.</p>
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
                    const created = await axios.post('/api/admin/waba/flows', { ...form, accountId })
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
                                setForm({ name: item.name, triggerType: item.triggerType, isActive: item.isActive })
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
                                <button type="button" className={ghostClass} disabled={saving} onClick={() => run(async () => {
                                    await axios.put(`/api/admin/waba/flows/${active.id}`, form)
                                })}>Save</button>
                                <button type="button" className={ghostClass} disabled={saving} onClick={() => run(async () => {
                                    if (!confirm('Delete this WhatsApp flow?')) return
                                    await axios.delete(`/api/admin/waba/flows/${active.id}`)
                                })}><Trash2 className="h-4 w-4" /></button>
                            </div>
                        </div>
                        <div className="grid gap-3 md:grid-cols-[6rem_7rem_1fr_auto]">
                            <input className={inputClass} type="number" min={1} value={stepForm.sequenceOrder} onChange={(e) => setStepForm({ ...stepForm, sequenceOrder: Number(e.target.value) })} />
                            <input className={inputClass} type="number" min={0} value={stepForm.delayHours} onChange={(e) => setStepForm({ ...stepForm, delayHours: Number(e.target.value) })} />
                            <select className={inputClass} value={stepForm.templateName} onChange={(e) => setStepForm({ ...stepForm, templateName: e.target.value })}>
                                <option value="">Approved template</option>
                                {approved.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
                            </select>
                            <button type="button" className={btnClass} disabled={saving || !stepForm.templateName} onClick={() => run(async () => {
                                await axios.post(`/api/admin/waba/flows/${active.id}/steps`, stepForm)
                                setStepForm({ sequenceOrder: active.steps.length + 2, delayHours: 0, templateName: '' })
                            })}>Add step</button>
                        </div>
                        <p className="text-xs font-semibold text-slate-400">Order · delay hours · template. Delay 0 sends immediately on the event.</p>
                        <div className="space-y-3">
                            {active.steps.map((step) => (
                                <div key={step.id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-4 py-3">
                                    <div>
                                        <p className="text-sm font-semibold text-slate-900">Step {step.sequenceOrder} · {step.templateName}</p>
                                        <p className="text-xs font-semibold text-slate-500">{step.delayHours === 0 ? 'Sends immediately' : `Sends after ${step.delayHours} hours`}</p>
                                    </div>
                                    <button type="button" className={ghostClass} disabled={saving} onClick={() => run(async () => {
                                        if (!confirm('Delete this step?')) return
                                        await axios.delete(`/api/admin/waba/flow-steps/${step.id}`)
                                    })}><Trash2 className="h-4 w-4" /></button>
                                </div>
                            ))}
                            {!active.steps.length && <p className="rounded-lg bg-slate-50 p-6 text-sm font-semibold text-slate-400">Add a template step. Submit and approve templates in the Templates tab first.</p>}
                        </div>
                    </>
                ) : (
                    <p className="p-8 text-sm font-semibold text-slate-400">Create a flow, then attach approved templates to the event.</p>
                )}
            </section>
        </div>
    )
}
