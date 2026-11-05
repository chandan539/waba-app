import express from 'express'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setWabaAdapters } from './adapters'
import { getWabaRelease, installedWabaVersion, webhookWabaUpdater } from './wabaUpdates'
import router from '../routes/wabaUpdates'

const commit = 'a'.repeat(40)
const json = (data: unknown) => new Response(JSON.stringify(data))
const [major, minor, patch] = installedWabaVersion.split('.').map(Number)
const nextVersion = `${major}.${minor}.${patch + 1}`
function mockGithub(tag = `v${nextVersion}`) {
    return vi.stubGlobal('fetch', vi.fn(async (url: string) =>
        url.endsWith('/releases/latest') ? json({ tag_name: tag }) : json({ sha: commit }),
    ))
}
function app() {
    return express().use(express.json()).use('/updates', router)
}
afterEach(() => vi.unstubAllGlobals())

describe('WABA releases', () => {
    it('offers a newer release pinned to its exact source commit', async () => {
        mockGithub()
        expect(await getWabaRelease()).toMatchObject({
            version: nextVersion,
            commit,
            archiveUrl: `https://github.com/chandan539/waba-app/archive/${commit}.tar.gz`,
        })
    })

    it.each([`v${installedWabaVersion}`, 'v0.0.0', `v${major + 1}.0.0-beta.1`])('does not offer %s', async tag => {
        mockGithub(tag)
        expect(await getWabaRelease()).toBeNull()
    })

    it('rejects unauthorized and stale update requests and dispatches the selected version', async () => {
        mockGithub()
        const updateWaba = vi.fn(async () => {})
        setWabaAdapters({ prisma: {}, updateWaba, requireAdmin: (_req, res) => res.sendStatus(403) })
        const server = app()
        expect((await request(server).post('/updates').send({ commit })).status).toBe(403)
        setWabaAdapters({ prisma: {}, updateWaba, requireAdmin: (_req, _res, next) => next() })
        expect((await request(server).post('/updates').send({ commit: 'stale' })).status).toBe(409)
        expect(updateWaba).not.toHaveBeenCalled()
        const result = await request(server).post('/updates').send({ commit, archiveUrl: 'https://attacker.test/' })
        expect(result.status).toBe(202)
        expect(updateWaba).toHaveBeenCalledWith(expect.objectContaining({ commit, archiveUrl: `https://github.com/chandan539/waba-app/archive/${commit}.tar.gz` }), expect.stringMatching(/^[a-f0-9]{64}$/))
    })

    it('keeps version visible when GitHub is unavailable', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 503 })))
        setWabaAdapters({ prisma: {}, requireAdmin: (_req, _res, next) => next() })
        const result = await request(app()).get('/updates')
        expect(result.body).toMatchObject({ installedVersion: installedWabaVersion, canUpdate: false, available: null, checkError: expect.any(String) })
    })

    it('sends a bearer token and idempotency key to the configured HTTPS host', async () => {
        mockGithub()
        const release = (await getWabaRelease())!
        const fetchHook = vi.fn(async () => new Response(null, { status: 202 }))
        vi.stubGlobal('fetch', fetchHook)
        await webhookWabaUpdater('https://deploy.example.test/waba', 'private-token')(release, 'stable-key')
        expect(fetchHook).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({
            redirect: 'error',
            headers: expect.objectContaining({ Authorization: 'Bearer private-token', 'Idempotency-Key': 'stable-key' }),
        }))
    })
})
