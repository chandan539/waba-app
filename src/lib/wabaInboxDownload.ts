import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Request, Response } from 'express'
import { getWabaPrisma } from './adapters'
import { inboxMedia } from './wabaInboxContent'
import { graphUrl } from './waba'

const maxBytes = 100 * 1024 * 1024
const metaMediaHosts = new Set(['lookaside.fbsbx.com', 'lookaside.facebook.com'])

export async function downloadWabaInboxAttachment(req: Request, res: Response) {
    res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' })
    const accountId = typeof req.query.accountId === 'string' ? req.query.accountId : ''
    if (!accountId) return res.status(400).json({ error: 'Choose the business number for this attachment.' })

    const db = getWabaPrisma()
    const abort = new AbortController()
    const onClose = () => abort.abort()
    res.once('close', onClose)
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(120000)])
    try {
        const message = await db.whatsAppMessage.findFirst({ where: { id: String(req.params.messageId), accountId } })
        const media = message && inboxMedia(message)
        if (!media) return res.status(404).json({ error: 'Attachment not found for this business number.' })
        if (+new Date(media.expiresAt) <= Date.now()) return res.status(410).json({ error: 'The 24-hour download window has ended.' })

        const account = await db.whatsAppAccount.findUnique({ where: { id: accountId } })
        if (!account?.accessToken || !account.phoneNumberId) return res.status(409).json({ error: 'The receiving number is no longer connected.' })
        const headers = { Authorization: `Bearer ${account.accessToken}` }
        const metadata = await fetch(graphUrl(`/${media.id}`, { phone_number_id: account.phoneNumberId }), { headers, signal, redirect: 'error' })
        if (metadata.status === 404 || metadata.status === 410) return res.status(410).json({ error: 'This attachment is no longer available from WhatsApp.' })
        if (!metadata.ok) throw new Error('Media lookup failed')
        const info = await metadata.json() as { url?: string; file_size?: number }
        if (Number(info.file_size) > maxBytes) return res.status(413).json({ error: 'Attachment exceeds 100 MB.' })

        const url = new URL(info.url || '')
        if (url.protocol !== 'https:' || !metaMediaHosts.has(url.hostname) || url.username || url.password || url.port) throw new Error('Unexpected Meta download URL')
        const upstream = await fetch(url, { headers, signal, redirect: 'error' })
        if (upstream.status === 404 || upstream.status === 410) return res.status(410).json({ error: 'This attachment is no longer available from WhatsApp.' })
        if (!upstream.ok || !upstream.body) throw new Error('Media download failed')
        if (Number(upstream.headers.get('content-length')) > maxBytes) {
            await upstream.body.cancel()
            return res.status(413).json({ error: 'Attachment exceeds 100 MB.' })
        }
        let bytes = 0
        const limit = new Transform({
            transform(chunk, _encoding, callback) {
                bytes += chunk.length
                if (bytes > maxBytes) callback(new Error('Attachment exceeds 100 MB'))
                else callback(null, chunk)
            },
        })
        res.attachment(media.filename).type('application/octet-stream')
        await pipeline(Readable.from(upstream.body as unknown as AsyncIterable<Uint8Array>), limit, res, { signal })
    } catch {
        if (!res.headersSent && !res.destroyed) {
            res.removeHeader('Content-Disposition')
            res.status(502).json({ error: 'Could not download the attachment from WhatsApp.' })
        }
    } finally {
        res.off('close', onClose)
    }
}
