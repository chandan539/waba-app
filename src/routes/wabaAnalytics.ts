import { Router } from 'express'
import { getWabaPrisma, wabaRequireAdmin } from '../lib/adapters'
import { getWabaAccount } from '../lib/wabaService'

const router = Router()
router.get('/', wabaRequireAdmin, async (req, res) => {
    try {
        const days = req.query.days === '7' ? 7 : 30
        const account = await getWabaAccount(String(req.query.accountId || ''))
        const end = new Date()
        end.setUTCHours(0, 0, 0, 0)
        end.setUTCDate(end.getUTCDate() + 1)
        const start = new Date(+end - days * 86400000)
        const dates = Array.from({ length: days }, (_, i) => new Date(+start + i * 86400000).toISOString().slice(0, 10))
        const db = getWabaPrisma()
        const where = { accountId: account?.id, createdAt: { gte: start, lt: end } }
        const [rows, leads, bookings, handovers] = account ? await Promise.all([
            db.$queryRawUnsafe(
                `SELECT to_char("createdAt", 'YYYY-MM-DD') AS day,
                    count(*) FILTER (WHERE direction = 'INBOUND')::int AS inbound,
                    count(*) FILTER (WHERE direction = 'OUTBOUND')::int AS outbound,
                    count(*) FILTER (WHERE direction = 'OUTBOUND' AND lower(status) IN ('delivered', 'read'))::int AS delivered,
                    count(*) FILTER (WHERE direction = 'OUTBOUND' AND lower(status) = 'read')::int AS read
                 FROM "WhatsAppMessage" WHERE "accountId" = $1 AND "createdAt" >= $2 AND "createdAt" < $3 GROUP BY 1`,
                account.id, start, end,
            ),
            db.whatsAppLead.count({ where }),
            db.whatsAppBooking.count({ where: { ...where, mode: 'LIVE', status: 'CONFIRMED' } }),
            db.whatsAppAssistantSession.count({ where: { accountId: account.id, handover: true } }),
        ]) : [[], 0, 0, 0]
        const daily = dates.map(day => rows.find((row: { day: string }) => row.day === day) || { day, inbound: 0, outbound: 0, delivered: 0, read: 0 })
        res.json({ daily, leads, bookings, handovers })
    } catch {
        res.status(500).json({ error: 'Could not load WhatsApp analytics' })
    }
})
export default router
