'use client'

export type WabaAccountChoice = {
    id: string
    displayName?: string | null
    displayPhone?: string | null
    connected: boolean
    pendingPhone?: boolean
}

export function wabaAccountLabel(account: WabaAccountChoice, accounts: WabaAccountChoice[]) {
    const name = account.displayName?.trim() || 'WhatsApp account'
    const similar = accounts.filter(item => (item.displayName?.trim() || 'WhatsApp account') === name)
    if (similar.length <= 1 && account.displayName?.trim()) return name

    const ending = account.displayPhone?.replace(/\D/g, '').slice(-4)
    if (ending && similar.filter(item => item.displayPhone?.replace(/\D/g, '').endsWith(ending)).length === 1) {
        return `${name} · •••• ${ending}`
    }
    return `${name} ${similar.findIndex(item => item.id === account.id) + 1}`
}

export function wabaConnectionLabel(status: {
    connected: boolean
    pendingPhone?: boolean
    cloudRegistered?: boolean
    phoneStatus?: string
    nameStatus?: string
    canSendMessage?: string
}) {
    if (status.pendingPhone) return 'Phone setup pending'
    if (!status.connected) return 'Not connected'
    if (status.canSendMessage === 'BLOCKED') return 'Sending blocked'
    if (status.nameStatus === 'DECLINED' || status.nameStatus === 'REJECTED') return 'Name declined'
    if (status.cloudRegistered) return 'Connected'
    if (status.phoneStatus) return `Phone status: ${status.phoneStatus.replaceAll('_', ' ').toLowerCase()}`
    return 'Connection unverified'
}

export function WabaAccountSelect({ accounts, activeId, connection, busy, onSelect, label = 'Active account' }: {
    accounts: WabaAccountChoice[]
    activeId?: string
    connection: string
    busy: boolean
    onSelect: (id: string) => void
    label?: string
}) {
    const selected = accounts.find(account => account.id === activeId)
    return (
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
            {accounts.length > 0 && <label className="flex min-w-0 max-w-full flex-wrap items-center gap-2 text-xs font-medium text-slate-600">
                {label}
                <select
                value={selected?.id || ''}
                disabled={busy}
                onChange={event => onSelect(event.target.value)}
                className="min-w-0 max-w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 disabled:opacity-60"
            >
                <option value="" disabled>Select an account</option>
                {accounts.map(account => <option key={account.id} value={account.id}>{wabaAccountLabel(account, accounts)}</option>)}
                </select>
            </label>}
            <span role="status" className={`rounded-full px-3 py-1.5 text-xs font-medium ${connection === 'Connected' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>
                {connection}
            </span>
        </div>
    )
}
