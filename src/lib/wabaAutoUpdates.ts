import { getWabaUpdater, wabaAutoUpdateEnabled } from './adapters'
import { enqueueAssistantJob } from './assistantStore'
import { getWabaRelease, wabaUpdateKey, type WabaRelease } from './wabaUpdates'

export async function queueWabaUpdate(release: WabaRelease) {
    await enqueueAssistantJob(`update:${wabaUpdateKey(release)}`, 'WABA_UPDATE', { commit: release.commit })
}

export async function checkWabaAutoUpdate() {
    if (!wabaAutoUpdateEnabled()) return
    const release = await getWabaRelease()
    if (release) await queueWabaUpdate(release)
}

export async function dispatchWabaAutoUpdate(commit: string) {
    const deploy = getWabaUpdater()
    if (!deploy) throw new Error('Wabix deployment hook is unavailable.')
    const release = await getWabaRelease()
    if (release?.commit === commit) await deploy(release, wabaUpdateKey(release))
}
