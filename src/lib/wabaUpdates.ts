import { createHash } from 'node:crypto'
import version from './wabaVersion.json'

const repository = 'chandan539/waba-app'
const releasesUrl = `https://github.com/${repository}/releases`
const api = `https://api.github.com/repos/${repository}`
export const installedWabaVersion = version.version
export const wabaReleasesUrl = releasesUrl

export type WabaRelease = {
    version: string
    tag: string
    commit: string
    archiveUrl: string
    releaseUrl: string
}
export type WabaUpdateAdapter = (
    release: WabaRelease,
    idempotencyKey: string,
) => Promise<void>

function stableVersion(value: unknown) {
    if (typeof value !== 'string' || !/^v?(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/.test(value)) return null
    return value.replace(/^v/, '').split('.').map(Number)
}

async function github(path: string): Promise<any> {
    const response = await fetch(api + path, {
        headers: { Accept: 'application/vnd.github+json' },
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
    })
    if (response.status === 404) return null
    if (!response.ok) throw new Error('GitHub release check failed')
    return response.json()
}

export async function getWabaRelease(): Promise<WabaRelease | null> {
    const latest = await github('/releases/latest')
    const candidate = stableVersion(latest?.tag_name)
    if (!candidate || latest.draft || latest.prerelease) return null
    const current = stableVersion(installedWabaVersion)!
    const difference = candidate.findIndex((part, index) => part !== current[index])
    if (difference === -1 || candidate[difference] < current[difference]) return null

    const tag = String(latest.tag_name)
    const resolved = await github(`/commits/${encodeURIComponent(tag)}`)
    const commit = resolved?.sha
    if (typeof commit !== 'string' || !/^[a-f0-9]{40}$/.test(commit)) {
        throw new Error('Could not resolve the release to a GitHub commit')
    }
    return {
        version: candidate.join('.'),
        tag,
        commit,
        archiveUrl: `https://github.com/${repository}/archive/${commit}.tar.gz`,
        releaseUrl: `${releasesUrl}/tag/${tag}`,
    }
}

export function webhookWabaUpdater(url: string, token: string): WabaUpdateAdapter {
    const endpoint = new URL(url)
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || !token.trim()) {
        throw new Error('The WABA deployment hook requires HTTPS and a bearer token')
    }
    return async (release, key) => {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
                'Idempotency-Key': key,
            },
            body: JSON.stringify({ repository, ...release }),
            redirect: 'error',
            signal: AbortSignal.timeout(12000),
        })
        if (!response.ok) throw new Error('The host deployment hook rejected the update')
    }
}

export function wabaUpdateKey(release: WabaRelease) {
    return createHash('sha256').update(`${repository}:${release.commit}`).digest('hex')
}
