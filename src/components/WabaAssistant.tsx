'use client'
import { useEffect, useState } from 'react'
import axios from 'axios'
import {
    Bot,
    CalendarDays,
    CheckCircle2,
    CircleAlert,
    Loader2,
    Plus,
    RefreshCw,
    Save,
    UserRound,
    Users,
} from 'lucide-react'
import { assistantDefaults } from '../lib/assistantDefaults'
import type { AssistantSettings } from '../lib/assistantTypes'
import { cn } from '../lib/cn'

const input =
    'w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600/20'
const button =
    'inline-flex items-center justify-center gap-2 rounded-lg bg-[#00685d] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50'
const secondary =
    'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 disabled:opacity-50'
const panel = 'rounded-xl border border-slate-200 bg-white p-5'
function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
    return (
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            {label}
            {children}
            {hint && <span className="text-xs font-normal leading-relaxed text-slate-500">{hint}</span>}
        </label>
    )
}
function Toggle({
    label,
    checked,
    onChange,
}: {
    label: string
    checked: boolean
    onChange: (value: boolean) => void
}) {
    return (
        <label className="flex items-center gap-3 text-sm text-slate-700">
            <input
                type="checkbox"
                className="h-4 w-4 accent-emerald-700"
                checked={checked}
                onChange={(event) => onChange(event.target.checked)}
            />
            {label}
        </label>
    )
}
export function WabaAssistant({ accountId }: { accountId: string }) {
    const [data, setData] = useState<any>(null)
    const [settings, setSettings] = useState<AssistantSettings>(assistantDefaults)
    const [section, setSection] = useState('setup')
    const [loading, setLoading] = useState(true)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [notice, setNotice] = useState('')
    const [slot, setSlot] = useState({ startsAt: '', endsAt: '', serviceId: 'default' })
    const [handoverPhone, setHandoverPhone] = useState('')
    const params = { accountId }
    const load = async (resetSettings = false) => {
        const result = await axios.get('/api/admin/waba/assistant', { params })
        setData(result.data)
        if (resetSettings) setSettings(result.data.settings)
    }
    useEffect(() => {
        let active = true
        setLoading(true)
        setData(null)
        setError('')
        axios
            .get('/api/admin/waba/assistant', { params })
            .then((result) => {
                if (active) {
                    setData(result.data)
                    setSettings(result.data.settings)
                }
            })
            .catch((err) => {
                if (active) setError(err.response?.data?.error || 'Could not load assistant')
            })
            .finally(() => {
                if (active) setLoading(false)
            })
        return () => {
            active = false
        }
    }, [accountId])
    const run = async (work: () => Promise<void>, message = '') => {
        setBusy(true)
        setError('')
        setNotice('')
        try {
            await work()
            await load()
            setNotice(message)
        } catch (err: any) {
            setError(err.response?.data?.error || err.message || 'Request failed')
        } finally {
            setBusy(false)
        }
    }
    const patch = <K extends keyof AssistantSettings>(key: K, value: AssistantSettings[K]) =>
        setSettings((previous) => ({ ...previous, [key]: value }))
    const textField = (key: keyof AssistantSettings, label: string, hint?: string, multiline = false) => (
        <Field label={label} hint={hint}>
            {multiline ? (
                <textarea
                    className={cn(input, key === 'knowledge' ? 'min-h-56' : 'min-h-24')}
                    value={String(settings[key])}
                    onChange={(event) => patch(key, event.target.value as never)}
                />
            ) : (
                <input
                    className={input}
                    value={String(settings[key])}
                    onChange={(event) => patch(key, event.target.value as never)}
                />
            )}
        </Field>
    )
    if (!accountId)
        return <div className={panel}>Connect a WhatsApp number in Settings to set up its assistant.</div>
    if (loading)
        return (
            <div className="flex min-h-64 items-center justify-center">
                <Loader2 className="animate-spin text-emerald-700" aria-label="Loading assistant" />
            </div>
        )
    return (
        <div className="space-y-5">
            {error && (
                <div role="alert" className="rounded-lg bg-rose-50 p-4 text-sm text-rose-800">
                    {error}
                </div>
            )}
            {notice && (
                <div role="status" className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800">
                    {notice}
                </div>
            )}
            <div className="grid gap-4 sm:grid-cols-3">
                {[
                    {
                        icon: Bot,
                        label: 'Assistant',
                        value: data?.settings.enabled ? `${data.settings.mode} · Enabled` : 'Disabled',
                    },
                    { icon: Users, label: 'Recent leads', value: data?.leads.length || 0 },
                    { icon: CalendarDays, label: 'Recent bookings', value: data?.bookings.length || 0 },
                ].map((item) => (
                    <div key={item.label} className={panel}>
                        <item.icon size={19} className="mb-3 text-[#00685d]" />
                        <p className="text-xs text-slate-500">{item.label}</p>
                        <p className="mt-1 text-xl font-semibold">{item.value}</p>
                    </div>
                ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
                {['setup', 'knowledge', 'bookings', 'leads', 'handover', 'diagnostics'].map((id) => (
                    <button
                        key={id}
                        type="button"
                        aria-pressed={section === id}
                        className={cn(
                            secondary,
                            section === id && 'border-emerald-700 bg-emerald-50 text-emerald-800',
                        )}
                        onClick={() => setSection(id)}
                    >
                        {id[0].toUpperCase() + id.slice(1)}
                    </button>
                ))}
                <button type="button" className={secondary} disabled={busy} onClick={() => run(() => load())}>
                    <RefreshCw size={15} />
                    Refresh
                </button>
            </div>
            {(section === 'setup' || section === 'knowledge') && (
                <>
                    {section === 'setup' ? (
                        <div className="grid gap-5 xl:grid-cols-2">
                            <section className={cn(panel, 'space-y-5')}>
                                <h2 className="font-semibold">Business & activation</h2>
                                <Toggle
                                    label="Enable automated assistant"
                                    checked={settings.enabled}
                                    onChange={(value) => patch('enabled', value)}
                                />
                                <Field
                                    label="Mode"
                                    hint="Test mode replies only to the numbers below and never confirms a real booking or payment."
                                >
                                    <select
                                        className={input}
                                        value={settings.mode}
                                        onChange={(event) => patch('mode', event.target.value as 'TEST' | 'LIVE')}
                                    >
                                        <option value="TEST">Test</option>
                                        <option value="LIVE">Live</option>
                                    </select>
                                </Field>
                                <Field label="Test phones" hint="Comma-separated numbers with country codes.">
                                    <input
                                        className={input}
                                        value={settings.testPhones.join(', ')}
                                        onChange={(event) =>
                                            patch(
                                                'testPhones',
                                                event.target.value.split(',').map((value) => value.trim()),
                                            )
                                        }
                                    />
                                </Field>
                                {textField('businessName', 'Business name')}
                                {textField('timezone', 'Timezone', 'IANA timezone, for example Asia/Kolkata.')}
                                {textField('businessHours', 'Business hours')}
                                {textField('language', 'Languages')}
                            </section>
                            <section className={cn(panel, 'space-y-5')}>
                                <h2 className="font-semibold">Welcome & resources</h2>
                                {textField(
                                    'welcome',
                                    'Welcome message',
                                    'Introduce the assistant as AI-assisted.',
                                    true,
                                )}
                                {textField('bannerUrl', 'Welcome banner URL', 'Public HTTPS image URL. Optional.')}
                                {textField('guideUrl', 'Guide PDF URL', 'Public HTTPS PDF URL. Optional.')}
                                {textField(
                                    'rateCardUrl',
                                    'Rate card image URL',
                                    'Public HTTPS image URL. Optional.',
                                )}
                                {textField('handoverMessage', 'Human handover message', undefined, true)}
                                <div className="grid gap-3 sm:grid-cols-2">
                                    {Object.entries(settings.menuLabels || assistantDefaults.menuLabels).map(
                                        ([key, value]) => (
                                            <Field
                                                key={key}
                                                label={`${key[0].toUpperCase() + key.slice(1)} menu label`}
                                            >
                                                <input
                                                    className={input}
                                                    maxLength={24}
                                                    value={value}
                                                    onChange={(event) =>
                                                        patch('menuLabels', {
                                                            ...settings.menuLabels,
                                                            [key]: event.target.value,
                                                        })
                                                    }
                                                />
                                            </Field>
                                        ),
                                    )}
                                </div>
                                <p className="rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-500">
                                    Default menu: business enquiry, book a call, guide, waitlist, ask a question
                                    and talk to a human. Booking appears only when enabled.
                                </p>
                            </section>
                        </div>
                    ) : (
                        <div className="grid gap-5 xl:grid-cols-[2fr_1fr]">
                            <section className={cn(panel, 'space-y-5')}>
                                <h2 className="font-semibold">Your business knowledge</h2>
                                {textField(
                                    'knowledge',
                                    'Services, pricing, policies & FAQs',
                                    'Only add approved business information. Unknown questions go to your team.',
                                    true,
                                )}
                                {textField('tone', 'Tone & response style', undefined, true)}
                            </section>
                            <section className={cn(panel, 'space-y-5')}>
                                <h2 className="font-semibold">Claude configuration</h2>
                                <Toggle
                                    label="Enable AI for typed questions"
                                    checked={settings.aiEnabled}
                                    onChange={(value) => patch('aiEnabled', value)}
                                />
                                {textField(
                                    'model',
                                    'Claude model ID',
                                    'Use a model available to your Anthropic account, or set CLAUDE_MODEL on the server.',
                                )}
                                <Field
                                    label="Daily AI request limit"
                                    hint="Shared across this number, measured in UTC days. Set provider spend limits separately."
                                >
                                    <input
                                        type="number"
                                        min={1}
                                        max={10000}
                                        className={input}
                                        value={settings.maxDailyAiCalls}
                                        onChange={(event) => patch('maxDailyAiCalls', Number(event.target.value))}
                                    />
                                </Field>
                                <p className="text-sm leading-relaxed text-slate-500">
                                    AI answers business questions and interprets booking dates. Slot reservations
                                    and payment confirmation are handled by application code.
                                </p>
                            </section>
                        </div>
                    )}
                    <button
                        type="button"
                        className={button}
                        disabled={busy || !data}
                        onClick={() =>
                            run(async () => {
                                const result = await axios.put('/api/admin/waba/assistant/settings', {
                                    accountId,
                                    settings,
                                })
                                setSettings(result.data.settings)
                            }, 'Assistant settings saved.')
                        }
                    >
                        <Save size={16} />
                        Save assistant settings
                    </button>
                </>
            )}
            {section === 'bookings' && (
                <div className="space-y-5">
                    <div className="grid gap-5 xl:grid-cols-2">
                        <section className={cn(panel, 'space-y-4')}>
                            <h2 className="font-semibold">Booking settings</h2>
                            <Toggle
                                label="Enable booking menu"
                                checked={settings.bookingEnabled}
                                onChange={(value) => patch('bookingEnabled', value)}
                            />
                            {textField('sessionName', 'Session name')}
                            <div className="grid grid-cols-2 gap-3">
                                <Field label="Price in minor units" hint="10000 means ₹100.00 for INR.">
                                    <input
                                        type="number"
                                        min={0}
                                        className={input}
                                        value={settings.priceMinor}
                                        onChange={(event) => patch('priceMinor', Number(event.target.value))}
                                    />
                                </Field>
                                {textField('currency', 'Currency')}
                            </div>
                            {textField(
                                'reminderTemplate',
                                'Approved reminder template name',
                                'Optional. Use merge tags {{name}}, {{bookingId}}, {{date}} and {{time}}. No template is submitted automatically.',
                            )}
                            <div className="space-y-3">
                                <h3 className="text-sm font-medium">Additional sessions</h3>
                                {(settings.bookingServices || []).map((service, index) => (
                                    <div
                                        key={service.id}
                                        className="space-y-2 rounded-lg border border-slate-200 p-3"
                                    >
                                        <Field label="Session name">
                                            <input
                                                className={input}
                                                value={service.name}
                                                onChange={(event) =>
                                                    patch(
                                                        'bookingServices',
                                                        settings.bookingServices.map((item, i) =>
                                                            i === index
                                                                ? { ...item, name: event.target.value }
                                                                : item,
                                                        ),
                                                    )
                                                }
                                            />
                                        </Field>
                                        <Field label="Session price in minor units">
                                            <input
                                                type="number"
                                                min={0}
                                                className={input}
                                                value={service.priceMinor}
                                                onChange={(event) =>
                                                    patch(
                                                        'bookingServices',
                                                        settings.bookingServices.map((item, i) =>
                                                            i === index
                                                                ? {
                                                                      ...item,
                                                                      priceMinor: Number(event.target.value),
                                                                  }
                                                                : item,
                                                        ),
                                                    )
                                                }
                                            />
                                        </Field>
                                        <button
                                            type="button"
                                            className={secondary}
                                            onClick={() =>
                                                patch(
                                                    'bookingServices',
                                                    settings.bookingServices.filter(
                                                        (item) => item.id !== service.id,
                                                    ),
                                                )
                                            }
                                        >
                                            Remove session
                                        </button>
                                    </div>
                                ))}
                                <button
                                    type="button"
                                    className={secondary}
                                    disabled={(settings.bookingServices || []).length >= 9}
                                    onClick={() =>
                                        patch('bookingServices', [
                                            ...(settings.bookingServices || []),
                                            { id: crypto.randomUUID(), name: 'New session', priceMinor: 0 },
                                        ])
                                    }
                                >
                                    Add session type
                                </button>
                            </div>
                            <button
                                className={button}
                                disabled={busy}
                                onClick={() =>
                                    run(async () => {
                                        await axios.put('/api/admin/waba/assistant/settings', {
                                            accountId,
                                            settings,
                                        })
                                    }, 'Booking settings saved.')
                                }
                                type="button"
                            >
                                Save booking settings
                            </button>
                        </section>
                        <section className={cn(panel, 'space-y-4')}>
                            <h2 className="font-semibold">Add an available slot</h2>
                            <p className="text-xs text-slate-500">
                                Enter times in your device’s timezone. Customers see {settings.timezone}. Each slot
                                is for one customer.
                            </p>
                            <Field label="Session">
                                <select
                                    className={input}
                                    value={slot.serviceId}
                                    onChange={(event) => setSlot({ ...slot, serviceId: event.target.value })}
                                >
                                    {[
                                        { id: 'default', name: settings.sessionName },
                                        ...(settings.bookingServices || []),
                                    ].map((service) => (
                                        <option key={service.id} value={service.id}>
                                            {service.name}
                                        </option>
                                    ))}
                                </select>
                            </Field>
                            <Field label="Start">
                                <input
                                    className={input}
                                    type="datetime-local"
                                    value={slot.startsAt}
                                    onChange={(event) => setSlot({ ...slot, startsAt: event.target.value })}
                                />
                            </Field>
                            <Field label="End">
                                <input
                                    className={input}
                                    type="datetime-local"
                                    value={slot.endsAt}
                                    onChange={(event) => setSlot({ ...slot, endsAt: event.target.value })}
                                />
                            </Field>
                            <button
                                type="button"
                                className={button}
                                disabled={busy || !slot.startsAt || !slot.endsAt}
                                onClick={() =>
                                    run(async () => {
                                        await axios.post('/api/admin/waba/assistant/slots', {
                                            accountId,
                                            serviceId: slot.serviceId,
                                            startsAt: new Date(slot.startsAt).toISOString(),
                                            endsAt: new Date(slot.endsAt).toISOString(),
                                        })
                                        setSlot({ startsAt: '', endsAt: '', serviceId: 'default' })
                                    }, 'Slot added.')
                                }
                            >
                                <Plus size={16} />
                                Add slot
                            </button>
                        </section>
                    </div>
                    <section className={panel}>
                        <h2 className="mb-4 font-semibold">Upcoming availability</h2>
                        <div className="space-y-2">
                            {data?.slots.map((item: any) => (
                                <div
                                    key={item.id}
                                    className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 py-3 text-sm"
                                >
                                    <span>
                                        {new Date(item.startsAt).toLocaleString()} ·{' '}
                                        {item.bookingId ? 'Reserved' : 'Available'}
                                    </span>
                                    <button
                                        type="button"
                                        className={secondary}
                                        disabled={busy || Boolean(item.bookingId)}
                                        onClick={() =>
                                            run(async () => {
                                                await axios.delete(`/api/admin/waba/assistant/slots/${item.id}`, {
                                                    params,
                                                })
                                            })
                                        }
                                    >
                                        Remove
                                    </button>
                                </div>
                            ))}
                            {!data?.slots.length && (
                                <p className="text-sm text-slate-500">No available slots yet.</p>
                            )}
                        </div>
                    </section>
                    <section className={panel}>
                        <h2 className="mb-4 font-semibold">Bookings</h2>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="text-xs text-slate-500">
                                    <tr>
                                        <th className="pb-3">Customer</th>
                                        <th>Time</th>
                                        <th>Status</th>
                                        <th>Payment</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data?.bookings.map((item: any) => (
                                        <tr key={item.id} className="border-t border-slate-100">
                                            <td className="py-3">
                                                {item.phone}
                                                <p className="text-xs text-slate-400">{item.id}</p>
                                            </td>
                                            <td>{new Date(item.startsAt).toLocaleString()}</td>
                                            <td>
                                                {item.mode} · {item.status}
                                            </td>
                                            <td>
                                                {item.currency} {(item.amountMinor / 100).toFixed(2)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {!data?.bookings.length && (
                                <p className="py-5 text-sm text-slate-500">
                                    Bookings appear here after a customer selects a slot.
                                </p>
                            )}
                        </div>
                    </section>
                </div>
            )}
            {section === 'leads' && (
                <section className={panel}>
                    <h2 className="mb-4 font-semibold">Captured enquiries & waitlist</h2>
                    {data?.leads.map((lead: any) => (
                        <div key={lead.id} className="border-t border-slate-100 py-4">
                            <div className="flex justify-between gap-3 text-sm">
                                <span className="font-medium">
                                    {lead.phone} · {lead.kind}
                                </span>
                                <span className="text-xs text-slate-400">
                                    {new Date(lead.createdAt).toLocaleString()}
                                </span>
                            </div>
                            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{lead.details.text}</p>
                        </div>
                    ))}
                    {!data?.leads.length && (
                        <p className="text-sm text-slate-500">
                            No leads yet. Customers can use Business enquiry or Join the waitlist.
                        </p>
                    )}
                </section>
            )}
            {section === 'handover' && (
                <section className={cn(panel, 'space-y-4')}>
                    <h2 className="font-semibold">Human handover</h2>
                    <p className="text-sm text-slate-500">
                        Take over a chat to pause the assistant. Reply from Shared inbox, then resume when your
                        team is finished.
                    </p>
                    <Field label="Customer phone">
                        <input
                            className={input}
                            value={handoverPhone}
                            onChange={(event) => setHandoverPhone(event.target.value)}
                            placeholder="Country code and number"
                        />
                    </Field>
                    <button
                        type="button"
                        className={button}
                        disabled={busy || !handoverPhone.trim()}
                        onClick={() =>
                            run(async () => {
                                await axios.post('/api/admin/waba/assistant/handover', {
                                    accountId,
                                    phone: handoverPhone,
                                    handover: true,
                                })
                                setHandoverPhone('')
                            }, 'Assistant paused for this customer.')
                        }
                    >
                        <UserRound size={16} />
                        Take over conversation
                    </button>
                    {data?.handovers.map((item: any) => (
                        <div
                            className="flex items-center justify-between gap-3 border-t border-slate-100 py-3"
                            key={item.id}
                        >
                            <span className="text-sm">{item.phone} · Automation paused</span>
                            <button
                                type="button"
                                className={secondary}
                                disabled={busy}
                                onClick={() =>
                                    run(async () => {
                                        await axios.post('/api/admin/waba/assistant/handover', {
                                            accountId,
                                            phone: item.phone,
                                            handover: false,
                                        })
                                    }, 'Assistant resumed for future messages.')
                                }
                            >
                                Resume assistant
                            </button>
                        </div>
                    ))}
                    {!data?.handovers.length && (
                        <p className="text-sm text-slate-500">No conversations awaiting a human.</p>
                    )}
                </section>
            )}
            {section === 'diagnostics' && (
                <div className="space-y-5">
                    <section className={panel}>
                        <h2 className="mb-4 font-semibold">Integration readiness</h2>
                        <div className="grid gap-3 sm:grid-cols-2">
                            {Object.entries(data?.readiness || {}).map(([key, ready]) => (
                                <div key={key} className="flex items-center gap-2 text-sm">
                                    {ready ? (
                                        <CheckCircle2 size={17} className="text-emerald-600" />
                                    ) : (
                                        <CircleAlert size={17} className="text-amber-500" />
                                    )}
                                    <span>
                                        {key}: {ready ? 'Configured' : 'Not configured'}
                                    </span>
                                </div>
                            ))}
                        </div>
                        <p className="mt-4 text-xs leading-relaxed text-slate-500">
                            The host app must run processAssistantJobs() continuously. Configure provider
                            credentials on the server. Calendar sync is optional when using the module’s own
                            availability slots.
                        </p>
                    </section>
                    <section className={panel}>
                        <h2 className="mb-4 font-semibold">Background processing</h2>
                        {data?.jobs.map((job: any) => (
                            <div
                                className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 py-3 text-sm"
                                key={job.id}
                            >
                                <div>
                                    {job.kind} · {job.status} · {job.attempts} attempts
                                    {job.error && <p className="mt-1 text-xs text-rose-700">{job.error}</p>}
                                </div>
                                {job.status === 'FAILED' && (
                                    <button
                                        type="button"
                                        className={secondary}
                                        disabled={busy}
                                        onClick={() =>
                                            run(async () => {
                                                await axios.post(
                                                    `/api/admin/waba/assistant/jobs/${job.id}/retry`,
                                                    { accountId },
                                                )
                                            })
                                        }
                                    >
                                        Retry
                                    </button>
                                )}
                            </div>
                        ))}
                        {!data?.jobs.length && <p className="text-sm text-slate-500">No jobs recorded yet.</p>}
                    </section>
                    <section className={panel}>
                        <h2 className="mb-3 font-semibold">Deliveries needing review</h2>
                        <p className="mb-3 text-xs text-slate-500">
                            An interrupted external send can have an unknown outcome. Check the customer’s inbox
                            before sending a manual replacement.
                        </p>
                        {data?.deliveries.map((item: any) => (
                            <p key={item.key} className="border-t border-slate-100 py-3 text-sm">
                                {item.phone} · {item.status}
                                <span className="block text-xs text-slate-500">{item.error || item.key}</span>
                            </p>
                        ))}
                        {!data?.deliveries.length && (
                            <p className="text-sm text-slate-500">No deliveries need review.</p>
                        )}
                    </section>
                </div>
            )}
        </div>
    )
}
