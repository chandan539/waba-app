'use client'

import { useEffect, useState } from 'react'
import axios from 'axios'
import { BarChart3, CalendarCheck, Download, MessageSquare, Users } from 'lucide-react'

type Day = { day: string; inbound: number; outbound: number; delivered: number; read: number }
type Report = { daily: Day[]; leads: number; bookings: number; handovers: number }

export function WabaAnalytics({ accountId }: { accountId: string }) {
    const [days, setDays] = useState(30)
    const [report, setReport] = useState<Report>()
    const [error, setError] = useState(false)
    useEffect(() => {
        const controller = new AbortController()
        setReport(undefined)
        setError(false)
        axios.get<Report>('/api/admin/waba/analytics', { params: { accountId, days }, signal: controller.signal })
            .then(({ data }) => setReport(data))
            .catch(() => { if (!controller.signal.aborted) setError(true) })
        return () => controller.abort()
    }, [accountId, days])

    const daily = report?.daily || []
    const total = (key: Exclude<keyof Day, 'day'>) => daily.reduce((sum, row) => sum + row[key], 0)
    const max = Math.max(1, ...daily.map(day => day.inbound + day.outbound))
    const cards = [
        { name: 'Messages', value: total('inbound') + total('outbound'), Icon: MessageSquare },
        { name: 'Delivered or read', value: total('delivered'), Icon: BarChart3 },
        { name: 'Captured leads', value: report?.leads, Icon: Users },
        { name: 'Confirmed bookings', value: report?.bookings, Icon: CalendarCheck },
    ]

    function download() {
        const csv = ['date_utc,inbound,outbound,delivered_or_read,read', ...daily.map(row => [row.day, row.inbound, row.outbound, row.delivered, row.read].join(','))].join('\n')
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
        const link = document.createElement('a')
        link.href = url
        link.download = 'waba-message-report.csv'
        link.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
    }

    return <section className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-500">Reporting for the selected WhatsApp number · UTC</p>
            <div className="flex gap-2">
                <select aria-label="Reporting period" value={days} onChange={event => setDays(Number(event.target.value))} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                    <option value={30}>Last 30 days</option><option value={7}>Last 7 days</option>
                </select>
                <button onClick={download} disabled={!report} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm disabled:opacity-50"><Download size={16} /> Export CSV</button>
            </div>
        </div>
        {error && <p role="alert" className="rounded-lg bg-rose-50 p-4 text-sm text-rose-800">Analytics could not be loaded. Check your host app’s database migration.</p>}
        {!report && !error && <p role="status" className="text-sm text-slate-500">Loading analytics…</p>}
        {report && <>
            <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
                {cards.map(({ name, value, Icon }) => <article key={name} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                    <Icon size={20} className="mb-3 text-[#00685d]" /><p className="text-sm text-slate-500">{name}</p>
                    <p className="mt-1 text-2xl font-semibold">{value?.toLocaleString()}</p>
                </article>)}
            </div>
            <div className="grid gap-5 xl:grid-cols-[2fr_1fr]">
                <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                    <h2 className="font-semibold">Message activity</h2>
                    <p className="mt-1 text-sm text-slate-500">Inbound and outbound messages by day</p>
                    <div className="mt-6 flex h-44 items-end gap-1 border-b border-slate-200" role="img" aria-label={`${total('inbound')} inbound and ${total('outbound')} outbound messages over ${days} days`}>
                        {daily.map(day => <div key={day.day} title={`${day.day}: ${day.inbound} inbound, ${day.outbound} outbound`} className="flex min-w-0 flex-1 flex-col justify-end overflow-hidden rounded-t-sm" style={{ height: `${100 * (day.inbound + day.outbound) / max}%` }}>
                            <div className="bg-[#635bff]" style={{ flexGrow: day.inbound }} /><div className="bg-[#008376]" style={{ flexGrow: day.outbound }} />
                        </div>)}
                    </div>
                    <div className="mt-3 flex justify-between text-xs text-slate-500"><span>{daily[0]?.day}</span><span>{daily.at(-1)?.day}</span></div>
                    <p className="mt-4 text-xs text-slate-600"><span className="text-[#635bff]">●</span> Inbound <span className="ml-3 text-[#008376]">●</span> Outbound</p>
                </article>
                <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                    <h2 className="font-semibold">Delivery & handover</h2>
                    <dl className="mt-4 divide-y divide-slate-100 text-sm">
                        {[['Outbound', total('outbound')], ['Delivered or read', total('delivered')], ['Read', total('read')], ['Currently awaiting staff', report.handovers]].map(([label, count]) =>
                            <div key={label} className="flex justify-between gap-2 py-3"><dt>{label}</dt><dd className="font-semibold">{count}</dd></div>)}
                    </dl>
                </article>
            </div>
        </>}
    </section>
}
