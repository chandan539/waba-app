export type AssistantSettings = {
    menuLabels: Record<string, string>
    enabled: boolean
    mode: 'TEST' | 'LIVE'
    testPhones: string[]
    businessName: string
    language: string
    timezone: string
    businessHours: string
    welcome: string
    knowledge: string
    tone: string
    handoverMessage: string
    bannerUrl: string
    guideUrl: string
    rateCardUrl: string
    aiEnabled: boolean
    model: string
    maxDailyAiCalls: number
    bookingServices: Array<{ id: string; name: string; priceMinor: number }>
    bookingEnabled: boolean
    sessionName: string
    priceMinor: number
    currency: string
    reminderTemplate: string
}
export type PaymentReceipt = {
    bookingId: string
    paymentId: string
    paymentReference: string
    amountMinor: number
    currency: string
    captured: boolean
}
export type AssistantAdapters = {
    createPayment?: (input: {
        bookingId: string
        amountMinor: number
        currency: string
        phone: string
        idempotencyKey: string
    }) => Promise<{ reference: string; url: string; qrUrl?: string }>
    cancelPayment?: (booking: any, idempotencyKey: string) => Promise<void>
    verifyPaymentWebhook?: (input: {
        provider: string
        rawBody: Buffer
        headers: Record<string, unknown>
    }) => Promise<PaymentReceipt | null>
    validateSlot?: (slot: {
        accountId: string
        startsAt: Date
        endsAt: Date
        externalId?: string | null
    }) => Promise<boolean>
    confirmBooking?: (
        booking: any,
        idempotencyKey: string,
    ) => Promise<{ meetingUrl?: string; externalId?: string }>
    onLead?: (lead: any, idempotencyKey: string) => Promise<void>
    onHandover?: (input: { accountId: string; phone: string }, idempotencyKey: string) => Promise<void>
}
