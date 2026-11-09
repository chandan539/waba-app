'use client'

import { useEffect, useState } from 'react'
import { useWabaApi } from './WabaHost'
import axios from 'axios'
import { Download, RefreshCw } from 'lucide-react'
import version from '../lib/wabaVersion.json'

type UpdateStatus = {
    installedVersion: string
    releasesUrl: string
    canUpdate: boolean
    available: { version: string; commit: string; releaseUrl: string } | null
    checkError?: string
}
const path = '/updates'

export function WabaUpdates() {
    const api = useWabaApi()
    const [status, setStatus] = useState<UpdateStatus>()
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [requested, setRequested] = useState('')
    const [checking, setChecking] = useState(true)

    async function check() {
        setChecking(true)
        setError('')
        try {
            const { data } = await api.get<UpdateStatus>(path)
            setStatus(data)
            setRequested(current => data.installedVersion === current ? '' : current)
        } catch {
            setError('Could not load update status.')
        } finally {
            setChecking(false)
        }
    }

    useEffect(() => { void check() }, [])

    async function update() {
        if (!status?.available || busy) return
        setBusy(true)
        setError('')
        try {
            const { data } = await api.post<{ requestedVersion: string }>(path, { commit: status.available.commit })
            setRequested(data.requestedVersion)
        } catch (err) {
            setError(axios.isAxiosError(err) ? err.response?.data?.error || 'Could not confirm the update request.' : 'Could not confirm the update request.')
        } finally {
            setBusy(false)
        }
    }

    const release = status?.available
    return (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
            <div>
                <h2 className="text-lg font-semibold text-slate-900">App updates</h2>
                <p className="mt-1 text-sm text-slate-600">Installed version <strong>v{status?.installedVersion || version.version}</strong></p>
            </div>
            <p className="text-sm text-slate-600" role="status">
                {requested ? `Update to v${requested} was sent to your deployment system. Check again after it finishes.`
                    : checking ? 'Checking GitHub…'
                    : status?.checkError || (release ? `v${release.version} is available.` : status && 'No newer stable release found.')}
            </p>
            {status && !status.canUpdate && <p className="text-sm text-slate-600">Your host app needs a deployment hook to enable one-click updates.</p>}
            {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
            <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => void update()} disabled={!status?.canUpdate || !release || Boolean(status?.checkError) || busy || checking || requested === release.version} className="inline-flex items-center gap-2 rounded-lg bg-[#00685d] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                    <Download size={16} /> {busy ? 'Requesting update…' : 'Update app'}
                </button>
                <button type="button" onClick={() => void check()} disabled={checking || busy} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold disabled:opacity-50">
                    <RefreshCw size={16} /> Check for updates
                </button>
                <a className="text-sm font-medium text-[#00685d] underline" href={release?.releaseUrl || status?.releasesUrl || 'https://github.com/chandan539/waba-app/releases'}>GitHub releases</a>
            </div>
        </section>
    )
}
