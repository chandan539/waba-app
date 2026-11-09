import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Bot, X } from 'lucide-react'
import { WabaBoard } from '../src/components/WabaBoard'
import { demoSettings } from './api'

const options = [
    ['enquiry', 'Share your name, email and what you need help with.'],
    ['book', 'Select a sample appointment. Demo holds do not charge or create calendar events.'],
    ['guide', 'In a connected app, this sends your configured business PDF in WhatsApp.'],
    ['waitlist', 'Send an email address to try the waitlist. Use a made-up address.'],
    ['ask', 'Ask a sample question about consultations or booking.'],
    ['human', 'A team member has been requested. The connected app pauses automatic replies for this conversation.'],
] as const
function Demo() {
    const [channels, setChannels] = useState(false)
    const [open, setOpen] = useState(false)
    const [text, setText] = useState('')
    const [step, setStep] = useState('')
    const [messages, setMessages] = useState<{ from: 'bot' | 'you'; text: string }[]>([])
    function reply(input: string, response: string) {
        setMessages(previous => [...previous, { from: 'you', text: input }, { from: 'bot', text: response }])
    }
    function send() {
        const input = text.trim()
        if (!input) return
        setText('')
        if (/^(hi|hello|menu)$/i.test(input)) { setStep(''); reply(input, demoSettings().welcome); return }
        if (/^human$/i.test(input)) { setStep('human'); reply(input, options[5][1]); return }
        if (step === 'human') { reply(input, 'This demo conversation is waiting for a human. Type menu to restart the preview.'); return }
        if (step === 'waitlist' || step === 'enquiry') {
            if (step === 'waitlist' && !/^\S+@\S+\.\S+$/.test(input)) { reply(input, 'Enter a sample email such as guest@example.com.'); return }
            setStep(''); reply(input, 'Thanks. In the connected app, the team would see this in AI assistant → Leads.'); return
        }
        if (/book|call|slot|shaam|appointment/i.test(input)) { setStep('book'); reply(input, options[1][1]); return }
        reply(input, demoSettings().knowledge || 'This sample assistant can show the menu and help you request a human.')
    }
    return <>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-100 bg-white px-4 py-3">
            <p className="text-sm text-slate-600"><strong className="text-[#00685d]">Interactive demo</strong> · Sample data and browser-only changes. No live WhatsApp, AI or payments.</p>
            <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded-lg border border-emerald-200 px-4 py-2 text-sm font-semibold text-[#00685d]" onClick={() => setChannels((value) => !value)}>{channels ? 'Back to the classic preview' : 'Preview Channels'}</button>
            <button type="button" className="flex items-center gap-2 rounded-lg bg-[#00685d] px-4 py-2 text-sm font-semibold text-white" onClick={() => setOpen(true)}><Bot size={17} /> Try the customer chat</button>
            </div>
        </div>
        <WabaBoard key={String(channels)} channels={channels} />
        {open && <section role="dialog" aria-label="WhatsApp customer preview" className="fixed inset-x-3 bottom-3 z-20 flex max-h-[85dvh] flex-col overflow-hidden rounded-xl border border-emerald-200 bg-white shadow-2xl sm:inset-x-auto sm:right-5 sm:w-[390px]">
            <header className="flex items-center justify-between bg-[#00685d] p-4 text-white"><div><h2 className="font-semibold">WhatsApp customer preview</h2><p className="text-xs text-emerald-100">Scripted demo · {demoSettings().businessName}</p></div><button aria-label="Close preview" onClick={() => setOpen(false)}><X size={20} /></button></header>
            <div className="space-y-2 overflow-y-auto bg-[#f2f7f4] p-4">
                <p className="rounded-lg bg-white p-3 text-sm">{demoSettings().welcome}</p>
                {messages.map((message, i) => <p key={i} className={`rounded-lg p-3 text-sm ${message.from === 'you' ? 'ml-8 bg-emerald-100' : 'mr-8 bg-white'}`}>{message.text}</p>)}
                {step !== 'human' && <div className="flex flex-wrap gap-2">{options.map(([id, response]) => <button key={id} className="rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs text-[#00685d]" onClick={() => { const label = demoSettings().menuLabels[id]; setStep(id); reply(label, response) }}>{demoSettings().menuLabels[id]}</button>)}</div>}
                {step === 'book' && <div className="flex flex-wrap gap-2">{['Tomorrow · 4:30 PM', 'Tomorrow · 6:00 PM'].map(slot => <button key={slot} className="rounded-lg bg-[#00685d] px-3 py-2 text-xs text-white" onClick={() => { setStep(''); reply(slot, 'Demo booking confirmed. No money was collected and no calendar event was created.') }}>{slot}</button>)}</div>}
            </div>
            <form className="flex gap-2 border-t border-slate-200 p-3" onSubmit={event => { event.preventDefault(); send() }}><input aria-label="Customer message" className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="Type hi, menu, or a question" value={text} onChange={event => setText(event.target.value)} /><button className="rounded-lg bg-[#00685d] px-4 py-2 text-sm text-white">Send</button></form>
        </section>}
    </>
}
createRoot(document.getElementById('root')!).render(<Demo />)
