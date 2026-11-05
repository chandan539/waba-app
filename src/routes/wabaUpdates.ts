import { Router } from 'express'
import { getWabaUpdater, wabaRequireAdmin } from '../lib/adapters'
import { getWabaRelease, installedWabaVersion, wabaReleasesUrl, wabaUpdateKey } from '../lib/wabaUpdates'

const router = Router()
router.use(wabaRequireAdmin)
router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store')
    next()
})

router.get('/', async (_req, res) => {
    const status = { installedVersion: installedWabaVersion, releasesUrl: wabaReleasesUrl, canUpdate: Boolean(getWabaUpdater()) }
    try {
        res.json({ ...status, available: await getWabaRelease() })
    } catch {
        res.json({ ...status, available: null, checkError: 'Could not check GitHub. Try again shortly.' })
    }
})

router.post('/', async (req, res) => {
    const deploy = getWabaUpdater()
    if (!deploy) return res.status(503).json({ error: 'This installation has no deployment hook configured.' })
    try {
        const release = await getWabaRelease()
        if (!release || req.body?.commit !== release.commit) {
            return res.status(409).json({ error: 'The available release changed. Check for updates again.' })
        }
        await deploy(release, wabaUpdateKey(release))
        res.status(202).json({ requestedVersion: release.version })
    } catch {
        res.status(502).json({ error: 'Could not confirm the update request. Check the host deployment status before retrying.' })
    }
})

export default router
