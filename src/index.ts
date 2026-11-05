export { setWabaAdapters } from './lib/adapters'
export { wabaConfig, resolveWabaWebhookUrl } from './lib/config'
export { WABA_FEATURE_PAUSED } from './lib/wabaFlags'
export {
    EVENT_WABA_TEMPLATES,
    WABA_FLOW_TRIGGERS,
    normalizeWabaPhone,
    parseWabaWebhookMessages,
} from './lib/waba'
export {
    applyWabaWebhook,
    ensureEventWabaSetup,
    maintainWabaConnection,
    processWhatsAppQueue,
    triggerWhatsAppFlow,
    sendWabaTemplate,
    sendWabaSessionText,
} from './lib/wabaService'
export { default as wabaAdminRouter } from './routes/waba'
export { default as wabaWebhookRouter } from './routes/wabaPublic'

export type { AssistantAdapters, AssistantSettings, PaymentReceipt } from './lib/assistantTypes'
export { assistantDefaults } from './lib/assistantDefaults'
export { processAssistantJobs } from './lib/assistantWorker'
export { razorpayAssistantAdapters, googleCalendarAssistantAdapters } from './lib/assistantProviders'
export { getAssistantSettings, saveAssistantSettings } from './lib/assistantStore'
export { listAvailableSlots, holdBooking, confirmBooking } from './lib/assistantBookings'

export { installedWabaVersion, webhookWabaUpdater } from './lib/wabaUpdates'
export type { WabaRelease, WabaUpdateAdapter } from './lib/wabaUpdates'
