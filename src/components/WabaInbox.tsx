'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useWabaApi } from './WabaHost'
import axios from 'axios'
import { Download, FileText, Loader2, Search, MessageSquare, UserRound } from 'lucide-react'
import { cn } from '../lib/cn'

type Conversation = {
    id: string
    phone: string
    accountId?: string | null
    archived?: boolean
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
    attachment?: { filename: string; expiresAt: string } | null
    sharedContacts?: { name: string; company: string; phones: string[]; emails: string[] }[]
}

const btnClass = 'inline-flex h-11 items-center justify-center rounded-lg bg-[#00685d] px-4 text-sm font-semibold text-white disabled:opacity-50'
const ghostClass = 'inline-flex h-11 items-center justify-center rounded-lg bg-slate-100 px-4 text-sm font-semibold text-slate-700'

function formatWhen(value?: string | null) {
    if (!value) return ''
    const date = new Date(value)
    if (!Number.isFinite(date.getTime())) return ''
    return date.toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })
}

type InboxNumber = { id: string; label?: string; displayName?: string; displayPhone?: string; phoneNumberId?: string; connected: boolean }
type InboxProps = {
    connected: boolean
    templates: Array<{ id: string; name: string; status: string }>
    accountId?: string
    displayPhone?: string
    lastWebhookAt?: string | null
    lastWebhookFields?: string
    accounts?: InboxNumber[]
}
const numberLabel = (number: InboxNumber) => [...new Set([
    number.displayName || number.label, number.displayPhone || number.phoneNumberId || number.label,
].filter(Boolean))].join(' · ') || 'Business number'

export function WabaInbox(props: InboxProps) {
    const numbers = (props.accounts || []).filter(account => account.connected)
    const [filter, setFilter] = useState('all')
    const selected = numbers.find(account => account.id === filter)
    const all = !selected
    const sendingAccount = selected || numbers.find(number => number.id === props.accountId) || numbers[0]
    const sendingId = sendingAccount?.id || props.accountId
    return <div className="min-w-0 space-y-3">
        <label className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold">
            Business number
            <select aria-label="Inbox business number" value={selected?.id || 'all'} onChange={e => setFilter(e.target.value)} className="min-w-0 max-w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal">
                <option value="all">All numbers and archived chats ({numbers.length || Number(props.connected)})</option>
                {numbers.map(account => <option key={account.id} value={account.id}>{numberLabel(account)}</option>)}
            </select>
        </label>
        <InboxThreads key={selected?.id || 'all'} {...props} all={all} numbers={numbers}
            connected={props.connected || numbers.length > 0} accountId={sendingId}
            displayPhone={sendingAccount?.displayPhone || props.displayPhone}
            templates={sendingId === props.accountId ? props.templates : []} />
    </div>
}

function InboxThreads({
    connected, templates, accountId, displayPhone, lastWebhookAt, lastWebhookFields, all, numbers,
}: InboxProps & { all: boolean; numbers: InboxNumber[] }) {
    const api = useWabaApi()
    const [search, setSearch] = useState('')
    const [unreadOnly, setUnreadOnly] = useState(false)
    const [page, setPage] = useState(1)
    const [hasNext, setHasNext] = useState(false)
    const [listBusy, setListBusy] = useState(true)
    const listKey = JSON.stringify([accountId, all, search, unreadOnly, page])
    const activeListKey = useRef(listKey)
    activeListKey.current = listKey
    const [conversations, setConversations] = useState<Conversation[]>([])
    const [thread, setThread] = useState<{ phone: string; accountId?: string | null; displayName?: string | null; archived?: boolean }>()
    const threadIdentity = useRef('')
    const activePhone = thread?.phone || ''
    const archived = Boolean(thread?.archived)
    const receivingId = archived ? thread?.accountId || undefined : thread?.accountId || accountId
    const [numberTemplates, setNumberTemplates] = useState<InboxProps['templates']>()
    const [threadTemplates, setThreadTemplates] = useState<InboxProps['templates']>()
    const [attachmentError, setAttachmentError] = useState('')
    const [downloading, setDownloading] = useState('')
    const businessName = (id?: string | null) => {
        const number = numbers.find(item => item.id === id)
        return number ? numberLabel(number) : displayPhone || 'Business number'
    }
    const [messages, setMessages] = useState<Message[]>([])
    const [olderCursor, setOlderCursor] = useState<string | null>(null)
    const [loadingOlder, setLoadingOlder] = useState(false)
    const [historyError, setHistoryError] = useState('')
    const didLoadThread = useRef(false)
    const scrollIntent = useRef<{ top: number; height: number } | 'bottom' | null>(null)
    const [canReply, setCanReply] = useState(false)
    const [draft, setDraft] = useState('')
    const [templateId, setTemplateId] = useState('')
    const [newPhone, setNewPhone] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const threadRef = useRef<HTMLDivElement>(null)
    const approved = (threadTemplates || (receivingId === accountId ? numberTemplates || templates : [])).filter((item) => String(item.status).toUpperCase() === 'APPROVED')
    const chosenTemplate = approved.some(item => item.id === templateId) ? templateId : approved[0]?.id || ''

    const loadInbox = async () => {
        const res = await api.get('/inbox', {
            params: { accountId, ...(all ? { scope: 'all' } : {}), page, search, unread: unreadOnly },
        })
        if (activeListKey.current !== listKey) return
        const rows = res.data.conversations || []
        if (!rows.length && page > 1) {
            setPage(page - 1)
            return
        }
        setConversations(rows)
        setHasNext(Boolean(res.data.hasNext))
        setNumberTemplates(res.data.templates)
    }

    const loadThread = async (phone: string, id = receivingId, archive = archived) => {
        if (!phone) return
        const key = `${archive ? 'archive:' : ''}${id || ''}:${phone}`
        const res = await api.get(`/inbox/${encodeURIComponent(phone)}`, { params: { accountId: id, archive } })
        if (threadIdentity.current !== key) return
        const incoming: Message[] = res.data.messages || []
        const pane = threadRef.current
        const firstLoad = !didLoadThread.current
        if (firstLoad || (pane && pane.scrollHeight - pane.scrollTop - pane.clientHeight < 48)) {
            if (!scrollIntent.current) scrollIntent.current = 'bottom'
        }
        if (firstLoad) setOlderCursor(res.data.olderCursor || null)
        didLoadThread.current = true
        setMessages(previous => {
            const ids = new Set(incoming.map(item => item.id))
            // Preserve pages already loaded and refresh the latest message statuses.
            const earlier = previous.filter(item => !ids.has(item.id))
            return [...earlier, ...incoming]
        })
        setThreadTemplates(res.data.templates)
        setCanReply(!!res.data.canReply)
        if (!archive && (res.data.contact?.unreadCount || 0) > 0) {
            await api.post('/inbox/read', { phone, accountId: id }).catch(() => null)
            setConversations(prev => prev.map(item => item.phone === phone && (item.accountId || accountId) === id ? { ...item, unreadCount: 0 } : item))
        }
    }

    async function loadOlder() {
        if (!olderCursor || !activePhone || loadingOlder) return
        const key = threadIdentity.current
        setLoadingOlder(true)
        setHistoryError('')
        try {
            const { data } = await api.get(`/inbox/${encodeURIComponent(activePhone)}`, {
                params: { accountId: receivingId, before: olderCursor, archive: archived },
            })
            if (threadIdentity.current !== key) return
            const pane = threadRef.current
            if (pane) scrollIntent.current = { top: pane.scrollTop, height: pane.scrollHeight }
            setMessages(previous => {
                const ids = new Set(previous.map(item => item.id))
                return [...(data.messages || []).filter((item: Message) => !ids.has(item.id)), ...previous]
            })
            setOlderCursor(data.olderCursor || null)
        } catch {
            if (threadIdentity.current === key) setHistoryError('Could not load older messages. Try again.')
        } finally {
            if (threadIdentity.current === key) setLoadingOlder(false)
        }
    }

    useEffect(() => () => { threadIdentity.current = '' }, [])

    useEffect(() => {
        setListBusy(true)
        const timer = window.setTimeout(() => {
            loadInbox()
                .catch(() => { if (activeListKey.current === listKey) setError('Could not load conversations.') })
                .finally(() => {
                    if (activeListKey.current === listKey) {
                        setListBusy(false)
                        setLoading(false)
                    }
                })
        }, search ? 200 : 0)
        return () => window.clearTimeout(timer)
    }, [listKey])

    useEffect(() => {
        const timer = window.setInterval(() => {
            loadInbox().catch(() => null)
            if (activePhone) loadThread(activePhone).catch(() => null)
        }, 8000)
        return () => window.clearInterval(timer)
    }, [activePhone, receivingId, archived, listKey])

    useLayoutEffect(() => {
        const pane = threadRef.current
        const intent = scrollIntent.current
        scrollIntent.current = null
        if (pane && intent) pane.scrollTop = intent === 'bottom' ? pane.scrollHeight : intent.top + pane.scrollHeight - intent.height
    }, [messages])

    const openThread = async (phone: string, id = accountId, displayName?: string | null, archive = false) => {
        const key = `${archive ? 'archive:' : ''}${id || ''}:${phone}`
        threadIdentity.current = key
        didLoadThread.current = false
        setThread({ phone, accountId: id, displayName, archived: archive })
        setDraft('')
        setError('')
        setAttachmentError('')
        setMessages([])
        setOlderCursor(null)
        setLoadingOlder(false)
        setHistoryError('')
        setThreadTemplates(undefined)
        setCanReply(false)
        await loadThread(phone, id, archive).catch(() => {
            if (threadIdentity.current === key) setError('Could not open this conversation.')
        })
    }

    async function downloadAttachment(item: Message) {
        if (!item.attachment || !receivingId || archived) return
        setAttachmentError('')
        setDownloading(item.id)
        try {
            const { data } = await api.get<Blob>(`/inbox/attachments/${encodeURIComponent(item.id)}`, {
                params: { accountId: receivingId }, responseType: 'blob',
            })
            const url = URL.createObjectURL(data)
            const link = document.createElement('a')
            link.href = url
            link.download = item.attachment.filename
            link.click()
            setTimeout(() => URL.revokeObjectURL(url), 1000)
        } catch (error) {
            const status = axios.isAxiosError(error) ? error.response?.status : undefined
            setAttachmentError(status === 410 ? 'This attachment is no longer available.' : 'Could not download this attachment. Try again shortly.')
        } finally { setDownloading('') }
    }

    const reply = async () => {
        if (archived || !activePhone || !draft.trim()) return
        setSaving(true)
        try {
            await api.post('/inbox/reply', { phone: activePhone, text: draft.trim(), accountId: receivingId })
            setDraft('')
            await Promise.all([loadThread(activePhone), loadInbox()])
        } catch (error: any) {
            alert(error.response?.data?.error || error.message || 'Could not send reply')
        } finally {
            setSaving(false)
        }
    }

    const sendTemplate = async (phone = activePhone) => {
        if (archived || !connected) return
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
            await api.post('/inbox/template', { phone, templateId: id, accountId: receivingId })
            setTemplateId(id)
            setNewPhone('')
            await Promise.all([phone === activePhone ? loadThread(phone) : openThread(phone, receivingId), loadInbox()])
        } catch (err: any) {
            setError(err.response?.data?.error || err.message || 'Could not send template')
        } finally {
            setSaving(false)
        }
    }

    if (loading) {
        return <div className="flex min-h-[30vh] items-center justify-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
    }

    if (!connected && !all) {
        return <p className="rounded-xl bg-amber-50 p-6 text-sm font-semibold text-amber-800">Connect WhatsApp first. Incoming chats appear here after someone messages the business number.</p>
    }

    const active = conversations.find((item) => item.phone === activePhone && Boolean(item.archived) === archived && (item.accountId || (archived ? undefined : accountId)) === receivingId)

    return (
        <div className="grid min-h-[32rem] overflow-hidden rounded-xl border border-slate-200 bg-white lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)_220px]">
            <aside className="border-b border-slate-200 lg:border-b-0 lg:border-r">
                <div className="flex items-center justify-between px-4 py-4">
                    <p className="text-base font-semibold text-slate-900">Conversations</p>
                    <button type="button" className="text-xs font-semibold text-[#00685d]" onClick={() => loadInbox().catch(() => null)}>Refresh</button>
                </div>
                <div className="space-y-3 px-4 pb-4"><label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2"><Search size={16} className="shrink-0 text-slate-400" /><input aria-label="Search conversations" className="min-w-0 w-full bg-transparent text-sm outline-none" placeholder="Search conversations…" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} /></label><div className="flex gap-2">{[false, true].map(unread => <button key={String(unread)} type="button" aria-pressed={unreadOnly === unread} onClick={() => { setUnreadOnly(unread); setPage(1) }} className={cn('rounded-full px-3 py-1 text-xs font-medium', unreadOnly === unread ? 'bg-[#00685d] text-white' : 'bg-slate-100 text-slate-600')}>{unread ? 'Unread' : 'All chats'}</button>)}</div></div>
                {!all && !lastWebhookAt && (
                    <p className="mx-4 mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                        Meta is not delivering inbound webhooks yet. Replies must go to {displayPhone || 'the Cloud API number'}. In Facebook Developer, switch App Mode to <span className="font-semibold">Live</span>, then reply once from a personal WhatsApp.
                    </p>
                )}
                <nav aria-label="Contact pages" className="flex items-center justify-between gap-2 border-t border-slate-200 p-3">
                    <button type="button" className="rounded border border-slate-200 px-2 py-1 text-xs disabled:opacity-40" disabled={page === 1 || listBusy} onClick={() => setPage(page - 1)}>Previous</button>
                    <span className="text-xs text-slate-500" aria-live="polite">Page {page} · 25 per page</span>
                    <button type="button" className="rounded border border-slate-200 px-2 py-1 text-xs disabled:opacity-40" disabled={!hasNext || listBusy} onClick={() => setPage(page + 1)}>Next</button>
                </nav>
                <div className="max-h-[22rem] overflow-y-auto lg:max-h-[36rem]">
                    {(listBusy ? [] : conversations).map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            disabled={saving} onClick={() => openThread(item.phone, item.archived ? item.accountId ?? '' : item.accountId || accountId, item.displayName, item.archived)}
                            className={cn('flex w-full flex-col gap-1 border-t border-slate-50 px-4 py-3 text-left', active?.id === item.id ? 'border-l-4 border-l-[#00685d] bg-emerald-50' : 'hover:bg-slate-50')}
                        >
                            <div className="flex items-center justify-between gap-2"><span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-semibold text-emerald-800">{(item.displayName || item.phone).slice(0, 2).toUpperCase()}</span>
                                <p className="truncate text-sm font-semibold text-slate-900">{item.displayName || item.phone}</p>
                                {(item.unreadCount || 0) > 0 && (
                                    <span className="rounded-full bg-[#00685d] px-2 py-0.5 text-[10px] font-semibold text-white">{item.unreadCount}</span>
                                )}
                            </div>
                            <p className="truncate text-xs font-medium text-[#00685d]">{item.archived ? 'Archived history' : businessName(item.accountId)}</p>
                            <p className="truncate text-xs font-semibold text-slate-500">{item.lastMessage || 'No messages yet'}</p>
                            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{formatWhen(item.lastMessageAt)}</p>
                        </button>
                    ))}
                    {listBusy && <p role="status" className="px-4 py-6 text-sm text-slate-500">Loading contacts…</p>}
                    {!listBusy && !conversations.length && (search || unreadOnly) && <p className="px-4 py-6 text-sm text-slate-500">No contacts match this filter.</p>}
                    {!listBusy && !conversations.length && !search && !unreadOnly && (
                        <p className="px-4 py-8 text-sm font-semibold text-slate-500">
                            {all ? 'No inbound chats across the connected numbers. ' : 'No inbound chats yet. Reply must come to '} {!all && <span className="font-semibold text-slate-900">{displayPhone || 'the Cloud API number'}</span>}
                            {all ? '' : lastWebhookAt ? ` · last Meta webhook ${formatWhen(lastWebhookAt)}${lastWebhookFields ? ` (${lastWebhookFields})` : ''}` : ' · Meta has not delivered a customer message webhook yet'}
                            . Start a chat with an approved template.
                        </p>
                    )}
                </div>

            </aside>
            <section className="flex min-h-[24rem] min-w-0 flex-col">
                {activePhone ? (
                    <>
                        <div className="border-b border-slate-200 px-5 py-4">
                            <p className="font-semibold text-slate-900">{active?.displayName || thread?.displayName || activePhone}</p>
                            <p className="mt-1 text-xs font-medium text-[#00685d]">{archived ? 'Archived history · Read only' : `Business number · ${businessName(receivingId)}`}</p>
                            <p className="text-xs font-semibold text-slate-500">{activePhone}{active?.optedOut ? ' · opted out' : canReply ? ' · 24-hour window open' : ' · send a template to restart'}</p>
                        </div>
                        <div ref={threadRef} className="max-h-[34rem] flex-1 space-y-3 overflow-y-auto bg-slate-50 p-5">
                            {olderCursor && <div className="text-center">
                                <button type="button" className={ghostClass} disabled={loadingOlder} onClick={() => void loadOlder()}>{loadingOlder ? 'Loading…' : 'Load older messages'}</button>
                            </div>}
                            {historyError && <p role="alert" className="text-sm text-rose-700">{historyError}</p>}
                            {messages.map((item) => (
                                <div key={item.id} className={cn('max-w-[80%] rounded-lg px-4 py-3 text-sm font-semibold', item.direction === 'OUTBOUND' ? 'ml-auto bg-[#00685d] text-white' : 'bg-white text-slate-800 shadow-sm')}>
                                    {item.body && item.body !== '[contacts]' && !/^\[(image|audio|video|sticker|document)\]$/.test(item.body) && <p className="whitespace-pre-wrap break-words">{item.body}</p>}
                                    {item.attachment ? <div className="mt-1 rounded-lg border border-slate-200 bg-white p-3 text-slate-800">
                                        <p className="flex items-center gap-2 break-all"><FileText size={16} className="shrink-0" />{item.attachment.filename}</p>
                                        {+new Date(item.attachment.expiresAt) > Date.now() && !archived ? <button type="button" disabled={!!downloading} onClick={() => void downloadAttachment(item)} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#00685d]"><Download size={14} />{downloading === item.id ? 'Downloading…' : 'Download attachment'}</button>
                                            : <p className="mt-2 text-xs text-slate-500">{archived ? 'Download unavailable in archived chats.' : 'Download expired after 24 hours.'}</p>}
                                    </div> : ['image', 'document', 'audio', 'video', 'sticker'].includes(item.type) && <p className="text-xs opacity-80">Attachment unavailable.</p>}
                                    {item.sharedContacts?.map((contact, index) => <div key={index} className="mt-2 space-y-1 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-800">
                                        <p className="flex items-center gap-2 text-xs text-slate-500"><UserRound size={15} /> Shared contact</p>
                                        <p className="break-words font-semibold">{contact.name}</p>
                                        {contact.company && <p className="break-words">{contact.company}</p>}
                                        {contact.phones.map((phone, index) => <p key={index} className="break-all font-normal">{phone}</p>)}
                                        {contact.emails.map((email, index) => <p key={index} className="break-all font-normal">{email}</p>)}
                                    </div>)}
                                    <p className={cn('mt-1 text-[10px] font-bold uppercase tracking-wide', item.direction === 'OUTBOUND' ? 'text-white/70' : 'text-slate-400')}>
                                        {item.direction === 'OUTBOUND' ? 'You' : 'Customer'} · {formatWhen(item.createdAt)}{item.status ? ` · ${item.status}` : ''}
                                    </p>
                                </div>
                            ))}
                            {!messages.length && <p className="text-sm font-semibold text-slate-400">No messages in this thread yet.</p>}
                        </div>
                        {archived ? <p className="border-t border-slate-200 p-4 text-sm text-slate-500">This history has no active sending number.</p> : <div className="space-y-3 border-t border-slate-200 p-4">
                            {attachmentError && <p role="alert" className="text-sm text-rose-700">{attachmentError}</p>}
                            {error && <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">{error}</p>}
                            <textarea
                                className="min-h-20 w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-normal text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
                                placeholder={canReply ? 'Write a reply…' : 'The 24-hour window is closed. Send an approved template instead.'}
                                value={draft}
                                disabled={!canReply || saving}
                                onChange={(e) => setDraft(e.target.value)}
                            />
                            <div className="flex flex-wrap gap-2">
                                <button type="button" className={btnClass} disabled={saving || !canReply || !draft.trim()} onClick={reply}>
                                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send reply'}
                                </button>
                                <select aria-label="Approved template" className="h-11 min-w-0 flex-1 rounded-lg bg-slate-50 px-3 text-sm font-semibold" value={chosenTemplate} onChange={(e) => setTemplateId(e.target.value)}>
                                    {!approved.length && <option value="">No approved template yet</option>}
                                    {approved.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                                </select>
                                <button type="button" className={ghostClass} disabled={saving || !chosenTemplate} onClick={() => sendTemplate()}>Send template</button>
                            </div>
                        </div>}
                    </>
                ) : (
                    <div className="flex flex-1 flex-col justify-center gap-4 p-8">
                        <div>
                            <MessageSquare className="mb-4 text-[#00685d]" size={36} /><p className="text-lg font-semibold text-slate-900">Start a conversation</p>
                            <p className="mt-1 text-sm font-semibold text-slate-500">New conversations use {businessName(accountId)}. WhatsApp only allows a free-text reply for 24 hours after they message you. To start, send an approved template. Order, quote, and warranty events use Flows, the same triggers as email.</p>
                        </div>
                        {error && <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">{error}</p>}
                        <input className="h-11 rounded-lg bg-slate-50 px-4 text-sm font-semibold" placeholder="Customer mobile" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
                        <div className="flex flex-wrap gap-2">
                            <select className="h-11 min-w-[12rem] flex-1 rounded-lg bg-slate-50 px-3 text-sm font-semibold" value={chosenTemplate} onChange={(e) => setTemplateId(e.target.value)}>
                                {!approved.length && <option value="">No approved template yet</option>}
                                {approved.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                            </select>
                            <button type="button" className={btnClass} disabled={!connected || saving || !newPhone.trim() || !approved.length} onClick={() => sendTemplate(newPhone.trim())}>
                                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send'}
                            </button>
                        </div>
                    </div>
                )}
            </section>
            <aside className="hidden border-l border-slate-200 bg-[#f2f4f7] p-4 xl:block"><h3 className="border-b border-slate-200 pb-4 text-sm font-semibold">Contact details</h3>{activePhone ? <div className="mt-6 space-y-5"><div className="text-center"><span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#00685d] text-xl font-semibold text-white">{(active?.displayName || thread?.displayName || activePhone).slice(0, 2).toUpperCase()}</span><p className="mt-3 break-words font-semibold">{active?.displayName || thread?.displayName || 'Customer'}</p><p className="mt-1 text-xs text-slate-500">{activePhone}</p></div><div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-xs"><p className="text-slate-500">Channel <span className="float-right text-[#00685d]">WhatsApp</span></p><p className="text-slate-500">Reply window</p><p className="font-medium">{canReply ? 'Open · replies available' : 'Closed · template required'}</p><p className="border-t border-slate-100 pt-3 text-slate-500">{active?.optedOut ? 'This contact has opted out.' : 'Use approved templates to start a conversation.'}</p></div></div> : <div className="mt-12 text-center text-sm text-slate-500"><UserRound className="mx-auto mb-3" size={30} />Select a conversation to view contact details.</div>}</aside>
        </div>
    )
}
