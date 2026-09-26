'use client'

import { useEffect, useRef, useState } from 'react'
import axios from 'axios'
import { Loader2 } from 'lucide-react'
import { cn } from '../lib/cn'

type Conversation = {
    id: string
    phone: string
    displayName?: string | null
    lastMessage?: string | null
    lastMessageAt?: string | null
    unreadCount?: number
    optedOut?: boolean
}

type Message = {
    id: string
    phone: string
    direction: string
    type: string
    body: string
    templateName?: string | null
    status?: string | null
    createdAt: string
}

const btnClass = 'inline-flex h-11 items-center justify-center rounded-2xl bg-[#001a72] px-4 text-sm font-black text-white disabled:opacity-50'
const ghostClass = 'inline-flex h-11 items-center justify-center rounded-2xl bg-slate-100 px-4 text-sm font-black text-slate-700'

function formatWhen(value?: string | null) {
    if (!value) return ''
    const date = new Date(value)
    if (!Number.isFinite(date.getTime())) return ''
    return date.toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })
}

export function WabaInbox({
    connected,
    templates,
    accountId,
    displayPhone,
    lastWebhookAt,
    lastWebhookFields,
}: {
    connected: boolean
    templates: Array<{ id: string; name: string; status: string }>
    accountId?: string
    displayPhone?: string
    lastWebhookAt?: string | null
    lastWebhookFields?: string
}) {
    const [conversations, setConversations] = useState<Conversation[]>([])
    const [activePhone, setActivePhone] = useState('')
    const [messages, setMessages] = useState<Message[]>([])
    const [canReply, setCanReply] = useState(false)
    const [draft, setDraft] = useState('')
    const [templateId, setTemplateId] = useState('')
    const [newPhone, setNewPhone] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const threadRef = useRef<HTMLDivElement>(null)
    const approved = templates.filter((item) => String(item.status).toUpperCase() === 'APPROVED')
    const chosenTemplate = templateId || approved[0]?.id || ''

    const loadInbox = async () => {
        const res = await axios.get('/api/admin/waba/inbox', { params: { accountId } })
        setConversations(res.data.conversations || [])
    }

    const loadThread = async (phone: string) => {
        if (!phone) return
        const res = await axios.get(`/api/admin/waba/inbox/${encodeURIComponent(phone)}`, { params: { accountId } })
        setMessages(res.data.messages || [])
        setCanReply(!!res.data.canReply)
        if ((res.data.contact?.unreadCount || 0) > 0) {
            await axios.post('/api/admin/waba/inbox/read', { phone, accountId }).catch(() => null)
            setConversations((prev) => prev.map((item) => item.phone === phone ? { ...item, unreadCount: 0 } : item))
        }
    }

    useEffect(() => {
        setActivePhone('')
        setMessages([])
        loadInbox().catch(() => null).finally(() => setLoading(false))
    }, [accountId])

    useEffect(() => {
        const timer = window.setInterval(() => {
            loadInbox().catch(() => null)
            if (activePhone) loadThread(activePhone).catch(() => null)
        }, 8000)
        return () => window.clearInterval(timer)
    }, [activePhone, accountId])

    useEffect(() => {
        threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight })
    }, [messages.length])

    const openThread = async (phone: string) => {
        setActivePhone(phone)
        setDraft('')
        await loadThread(phone).catch((error) => alert(error.response?.data?.error || 'Could not open chat'))
    }

    const reply = async () => {
        if (!activePhone || !draft.trim()) return
        setSaving(true)
        try {
            await axios.post('/api/admin/waba/inbox/reply', { phone: activePhone, text: draft.trim(), accountId })
            setDraft('')
            await Promise.all([loadThread(activePhone), loadInbox()])
        } catch (error: any) {
            alert(error.response?.data?.error || error.message || 'Could not send reply')
        } finally {
            setSaving(false)
        }
    }

    const sendTemplate = async (phone = activePhone) => {
        const id = chosenTemplate
        if (!phone.trim()) {
            setError('Enter the customer mobile number')
            return
        }
        if (!id) {
            setError('No approved template is ready. Open Templates and sync from Meta first.')
            return
        }
        setSaving(true)
        setError('')
        try {
            await axios.post('/api/admin/waba/inbox/template', { phone, templateId: id, accountId })
            setTemplateId(id)
            setActivePhone(phone)
            setNewPhone('')
            await Promise.all([loadThread(phone), loadInbox()])
        } catch (err: any) {
            setError(err.response?.data?.error || err.message || 'Could not send template')
        } finally {
            setSaving(false)
        }
    }

    if (loading) {
        return <div className="flex min-h-[30vh] items-center justify-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
    }

    if (!connected) {
        return <p className="rounded-[1.5rem] bg-amber-50 p-6 text-sm font-semibold text-amber-800">Connect WhatsApp first. Incoming chats appear here after someone messages the business number.</p>
    }

    const active = conversations.find((item) => item.phone === activePhone)

    return (
        <div className="grid min-h-[32rem] overflow-hidden rounded-[2rem] border border-slate-100 bg-white lg:grid-cols-[18rem_1fr]">
            <aside className="border-b border-slate-100 lg:border-b-0 lg:border-r">
                <div className="flex items-center justify-between px-4 py-4">
                    <p className="text-xs font-black uppercase tracking-widest text-slate-400">Inbox</p>
                    <button type="button" className="text-xs font-black text-[#001a72]" onClick={() => loadInbox().catch(() => null)}>Refresh</button>
                </div>
                {!lastWebhookAt && (
                    <p className="mx-4 mb-3 rounded-2xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                        Meta is not delivering inbound webhooks yet. Replies must go to {displayPhone || 'the Cloud API number'}. In Facebook Developer, switch App Mode to <span className="font-black">Live</span>, then reply once from a personal WhatsApp.
                    </p>
                )}
                <div className="max-h-[22rem] overflow-y-auto lg:max-h-[36rem]">
                    {conversations.map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            onClick={() => openThread(item.phone)}
                            className={cn('flex w-full flex-col gap-1 border-t border-slate-50 px-4 py-3 text-left', activePhone === item.phone ? 'bg-slate-50' : 'hover:bg-slate-50')}
                        >
                            <div className="flex items-center justify-between gap-2">
                                <p className="truncate text-sm font-black text-slate-900">{item.displayName || item.phone}</p>
                                {(item.unreadCount || 0) > 0 && (
                                    <span className="rounded-full bg-[#001a72] px-2 py-0.5 text-[10px] font-black text-white">{item.unreadCount}</span>
                                )}
                            </div>
                            <p className="truncate text-xs font-semibold text-slate-500">{item.lastMessage || 'No messages yet'}</p>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{formatWhen(item.lastMessageAt)}</p>
                        </button>
                    ))}
                    {!conversations.length && (
                        <p className="px-4 py-8 text-sm font-semibold text-slate-500">
                            No inbound chats yet. Reply must come to <span className="font-black text-slate-900">{displayPhone || 'the Cloud API number'}</span>
                            {lastWebhookAt ? ` · last Meta webhook ${formatWhen(lastWebhookAt)}${lastWebhookFields ? ` (${lastWebhookFields})` : ''}` : ' · Meta has not delivered a customer message webhook yet'}
                            . Start a chat with an approved template.
                        </p>
                    )}
                </div>
            </aside>
            <section className="flex min-h-[24rem] flex-col">
                {activePhone ? (
                    <>
                        <div className="border-b border-slate-100 px-5 py-4">
                            <p className="font-black text-slate-900">{active?.displayName || activePhone}</p>
                            <p className="text-xs font-semibold text-slate-500">{activePhone}{active?.optedOut ? ' · opted out' : canReply ? ' · 24-hour window open' : ' · send a template to restart'}</p>
                        </div>
                        <div ref={threadRef} className="flex-1 space-y-3 overflow-y-auto bg-slate-50 p-5">
                            {messages.map((item) => (
                                <div key={item.id} className={cn('max-w-[80%] rounded-2xl px-4 py-3 text-sm font-semibold', item.direction === 'OUTBOUND' ? 'ml-auto bg-[#001a72] text-white' : 'bg-white text-slate-800 shadow-sm')}>
                                    <p className="whitespace-pre-wrap">{item.body}</p>
                                    <p className={cn('mt-1 text-[10px] font-bold uppercase tracking-widest', item.direction === 'OUTBOUND' ? 'text-white/70' : 'text-slate-400')}>
                                        {item.direction === 'OUTBOUND' ? 'You' : 'Customer'} · {formatWhen(item.createdAt)}{item.status ? ` · ${item.status}` : ''}
                                    </p>
                                </div>
                            ))}
                            {!messages.length && <p className="text-sm font-semibold text-slate-400">No messages in this thread yet.</p>}
                        </div>
                        <div className="space-y-3 border-t border-slate-100 p-4">
                            {error && <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">{error}</p>}
                            <textarea
                                className="min-h-20 w-full rounded-2xl bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900"
                                placeholder={canReply ? 'Write a reply…' : 'The 24-hour window is closed. Send an approved template instead.'}
                                value={draft}
                                disabled={!canReply || saving}
                                onChange={(e) => setDraft(e.target.value)}
                            />
                            <div className="flex flex-wrap gap-2">
                                <button type="button" className={btnClass} disabled={saving || !canReply || !draft.trim()} onClick={reply}>
                                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send reply'}
                                </button>
                                <select className="h-11 min-w-[12rem] flex-1 rounded-2xl bg-slate-50 px-3 text-sm font-semibold" value={chosenTemplate} onChange={(e) => setTemplateId(e.target.value)}>
                                    {approved.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                                </select>
                                <button type="button" className={ghostClass} disabled={saving || !chosenTemplate} onClick={() => sendTemplate()}>Send template</button>
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="flex flex-1 flex-col justify-center gap-4 p-8">
                        <div>
                            <p className="text-lg font-black text-slate-900">Chat with a customer</p>
                            <p className="mt-1 text-sm font-semibold text-slate-500">WhatsApp only allows a free-text reply for 24 hours after they message you. To start, send an approved template. Order, quote, and warranty events use Flows, the same triggers as email.</p>
                        </div>
                        {error && <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">{error}</p>}
                        <input className="h-11 rounded-2xl bg-slate-50 px-4 text-sm font-semibold" placeholder="Customer mobile" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
                        <div className="flex flex-wrap gap-2">
                            <select className="h-11 min-w-[12rem] flex-1 rounded-2xl bg-slate-50 px-3 text-sm font-semibold" value={chosenTemplate} onChange={(e) => setTemplateId(e.target.value)}>
                                {!approved.length && <option value="">No approved template yet</option>}
                                {approved.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                            </select>
                            <button type="button" className={btnClass} disabled={saving || !newPhone.trim() || !approved.length} onClick={() => sendTemplate(newPhone.trim())}>
                                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send'}
                            </button>
                        </div>
                    </div>
                )}
            </section>
        </div>
    )
}
