'use client'

import { useEffect, useState } from 'react'
import { ArrowUpRight, MessageCircle, Plug, QrCode } from 'lucide-react'
import QRCode from 'qrcode'
import { WabaAccountSelect } from './WabaAccountSelect'

type Channel = {
    id: string
    isSelected: boolean
    connected: boolean
    displayName: string
    displayPhone: string
    label: string
}

export function WabaChannels({ accounts, connection, busy, onSelect, onConnect, onSettings }: {
    accounts: Channel[]
    connection: string
    busy: boolean
    onSelect: (id: string) => void
    onConnect: () => void
    onSettings: () => void
}) {
    const active = accounts.find((account) => account.isSelected)
    const phone = active?.displayPhone.replace(/\D/g, '') || ''
    const chatLink = active?.connected && /^[1-9]\d{6,14}$/.test(phone) ? `https://wa.me/${phone}` : ''
    const [qr, setQr] = useState<{ link: string; image: string }>()
    const [qrFailed, setQrFailed] = useState(false)

    useEffect(() => {
        if (!chatLink) return
        let current = true
        setQrFailed(false)
        QRCode.toDataURL(chatLink, { width: 224, margin: 2 })
            .then((image) => { if (current) setQr({ link: chatLink, image }) })
            .catch(() => { if (current) setQrFailed(true) })
        return () => { current = false }
    }, [chatLink])

    return (
        <div className="grid gap-5 xl:grid-cols-2">
            <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
                <div className="flex items-center gap-3">
                    <span className="rounded-lg bg-emerald-50 p-2.5 text-emerald-700"><MessageCircle size={22} /></span>
                    <div>
                        <h2 className="font-semibold text-slate-900">WhatsApp Business</h2>
                        <p className="text-sm text-slate-500">{accounts.filter((account) => account.connected).length} connected</p>
                    </div>
                </div>
                <WabaAccountSelect label="Active channel" accounts={accounts} activeId={active?.id} connection={connection} busy={busy} onSelect={onSelect} />
                <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={busy} onClick={onConnect} className="rounded-lg bg-[#00685d] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                        {active?.connected ? 'Connect another number' : 'Connect with Meta'}
                    </button>
                    <button type="button" onClick={onSettings} className="inline-flex items-center gap-2 rounded-lg bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700"><Plug size={16} /> Connection settings</button>
                </div>
            </section>
            <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
                <div className="flex items-center gap-3">
                    <span className="rounded-lg bg-slate-100 p-2.5 text-slate-700"><QrCode size={22} /></span>
                    <div>
                        <h2 className="font-semibold text-slate-900">Share your channel</h2>
                        <p className="text-sm text-slate-500">Give customers a direct link to chat on WhatsApp.</p>
                    </div>
                </div>
                {chatLink ? <div className="flex flex-wrap items-center gap-4">
                    {qr && qr.link === chatLink && <img src={qr.image} width={112} height={112} alt="QR code to open your WhatsApp channel" />}
                    <div className="flex flex-wrap gap-3 text-sm font-medium text-[#00685d]">
                        <a href={chatLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1">Open chat <ArrowUpRight size={15} /></a>
                        {qr && qr.link === chatLink && <a href={qr.image} download={`whatsapp-${phone}.png`}>Download QR</a>}
                        {qrFailed && <p role="status">The chat link is ready. The QR code could not be generated.</p>}
                    </div>
                </div> : <p className="text-sm text-slate-500">Select a connected channel with a display number to generate its chat link and QR code.</p>}
            </section>
        </div>
    )
}
