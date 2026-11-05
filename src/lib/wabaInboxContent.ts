const downloadWindow = 24 * 60 * 60 * 1000
const mediaTypes = new Set(['image', 'document', 'audio', 'video', 'sticker'])
const extensionByMime: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf',
    'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'video/mp4': 'mp4',
}

function clean(value: unknown, limit = 200) {
    return typeof value === 'string' ? value.trim().slice(0, limit) : ''
}

export function inboxMedia(message: { type: string; raw?: any; createdAt: Date | string }) {
    if (!mediaTypes.has(message.type)) return null
    const raw = message.raw?.[message.type]
    const id = clean(raw?.id, 80)
    if (!/^\d{1,80}$/.test(id)) return null
    const mime = clean(raw?.mime_type).split(';')[0].toLowerCase()
    const filename = clean(raw?.filename, 150).replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_')
    const expires = +new Date(message.createdAt) + downloadWindow
    if (!Number.isFinite(expires)) return null
    return { id, filename: filename || `whatsapp-${message.type}.${extensionByMime[mime] || 'bin'}`, expiresAt: new Date(expires).toISOString() }
}

export function inboxContacts(raw: any) {
    if (!Array.isArray(raw?.contacts)) return []
    return raw.contacts.slice(0, 20).map((contact: any) => ({
        name: clean(contact?.name?.formatted_name) || [clean(contact?.name?.first_name), clean(contact?.name?.last_name)].filter(Boolean).join(' ') || 'Shared contact',
        company: clean(contact?.org?.company),
        phones: Array.isArray(contact?.phones) ? contact.phones.slice(0, 10).map((row: any) => clean(row?.phone) || clean(row?.wa_id)).filter(Boolean) as string[] : [],
        emails: Array.isArray(contact?.emails) ? contact.emails.slice(0, 10).map((row: any) => clean(row?.email)).filter(Boolean) as string[] : [],
    }))
}
