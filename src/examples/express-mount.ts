export { mountWaba } from '../lib/mountWaba'
import { triggerWhatsAppFlow } from '../lib/wabaService'

/** Call this from order / lead / warranty handlers. */
export async function notifyWhatsApp(triggerType: string, context: {
    phone?: string | null
    contactPhone?: string | null
    name?: string
    email?: string
    orderId?: string
    total?: string
    awb?: string
    userId?: string
}) {
    return triggerWhatsAppFlow(triggerType, context)
}
