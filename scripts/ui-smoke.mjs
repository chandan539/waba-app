// UI interaction/layout checks use fixtures; server behavior is covered by the Postgres integration suite.
import { build } from 'esbuild'
import { chromium } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import path from 'node:path'
import assert from 'node:assert/strict'
const directory = path.resolve('node_modules/.cache/waba-ui')
await mkdir(directory, { recursive: true })
await writeFile(path.join(directory, 'input.css'), '@import "tailwindcss";\n@source "../../../src/components";\n')
execFileSync('node_modules/.bin/tailwindcss', ['-i', path.join(directory, 'input.css'), '-o', path.join(directory, 'style.css')], { stdio: 'inherit' })
await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {WabaBoard} from './src/components/WabaBoard'; import {WabaModule} from './src/components/WabaModule'; createRoot(document.getElementById('root')).render(location.hash === '#module' ? <WabaModule apiBase="/api/tools/wabix"/> : <WabaBoard/>);`, resolveDir: process.cwd(), loader: 'tsx' }, jsx: 'automatic', bundle: true, platform: 'browser', outfile: path.join(directory, 'app.js') })
await writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body style="margin:0;background:#f7f9fc;padding:16px"><div id="root"></div><script src="/app.js"></script></body></html>')
const server = createServer(async (req, res) => { try { const pathname = new URL(req.url, 'http://localhost').pathname; const name = ['/', '/tools/whatsapp'].includes(pathname) ? 'index.html' : pathname.slice(1); if (!['index.html', 'app.js', 'style.css'].includes(name)) { res.writeHead(404).end(); return } res.setHeader('content-type', name.endsWith('.js') ? 'application/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html'); res.end(await readFile(path.join(directory, name))) } catch { res.writeHead(404).end() } })
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHROME_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROME_PATH } : {}) })
try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    let settings = { enabled: false, mode: 'TEST', testPhones: [], menuLabels: { enquiry: 'Business enquiry', book: 'Book a call', guide: 'Get our guide', waitlist: 'Join the waitlist', ask: 'Ask a question', human: 'Talk to a human' }, businessName: 'Acme Studio', language: 'English, Hindi and Hinglish', timezone: 'Asia/Kolkata', businessHours: 'Mon–Fri, 9am–6pm', welcome: 'Welcome! I’m your AI-assisted business assistant.', knowledge: 'Business consultations and design services.', tone: 'Warm and helpful.', handoverMessage: 'Our team will help shortly.', bannerUrl: '', guideUrl: '', rateCardUrl: '', aiEnabled: false, model: '', maxDailyAiCalls: 50, bookingEnabled: false, sessionName: 'Consultation', priceMinor: 0, currency: 'INR', reminderTemplate: '' }
    let handovers = [], saved = 0, updateRequested = false
    const updateCommit = 'a'.repeat(40)
    await page.route('**/api/admin/waba**', async route => {
        const url = new URL(route.request().url()), request = route.request()
        let data = {}
        if (url.pathname === '/api/admin/waba') data = { status: { id: 'preview', connected: true, cloudRegistered: true, displayName: 'Acme Studio', displayPhone: '+91 98765 43210', accounts: [] }, templates: [], campaigns: [], queue: [] }
        else if (url.pathname === '/api/admin/waba/inbox') data = { conversations: [] }
        else if (url.pathname.endsWith('/updates')) {
            if (request.method() === 'POST') {
                assert.equal(request.postDataJSON().commit, updateCommit)
                updateRequested = true
                data = { requestedVersion: '1.2.0' }
            } else data = { installedVersion: '1.1.0', canUpdate: true, available: { version: '1.2.0', commit: updateCommit, releaseUrl: 'https://github.com/chandan539/waba-app/releases/tag/v1.2.0' } }
        }
        else if (url.pathname.endsWith('/assistant/settings')) { settings = request.postDataJSON().settings; saved++; data = { settings } }
        else if (url.pathname.endsWith('/assistant/handover')) { const body = request.postDataJSON(); handovers = body.handover ? [{ id: 'h1', phone: body.phone }] : []; data = { success: true } }
        else if (url.pathname.endsWith('/assistant')) data = { settings, leads: [], bookings: [], slots: [], handovers, jobs: [], deliveries: [], readiness: { aiKey: false, payments: false, calendar: false, leadSync: false, media: false } }
        await route.fulfill({ json: data })
    })
    await page.goto(`http://127.0.0.1:${server.address().port}`)
    await page.getByRole('button', { name: 'AI assistant', exact: true }).click()
    await page.getByLabel('Business name', { exact: true }).fill('Updated Studio')
    await page.getByRole('button', { name: 'Save assistant settings' }).click()
    await page.getByRole('status').filter({ hasText: 'Assistant settings saved' }).waitFor()
    assert.equal(saved, 1); assert.equal(settings.businessName, 'Updated Studio')
    await page.screenshot({ path: path.join(directory, 'assistant-desktop.png'), fullPage: true })
    await page.getByRole('button', { name: 'Knowledge', exact: true }).click()
    await page.getByLabel('Services, pricing, policies & FAQs').waitFor()
    await page.getByRole('button', { name: 'Handover', exact: true }).click()
    await page.getByLabel('Customer phone', { exact: true }).fill('919876543210')
    await page.getByRole('button', { name: 'Take over conversation' }).click()
    await page.getByRole('button', { name: 'Resume assistant' }).click()
    await page.getByText('No conversations awaiting a human.').waitFor()
    for (const name of ['Bookings', 'Leads', 'Diagnostics']) await page.getByRole('button', { name, exact: true }).click()
    await page.setViewportSize({ width: 390, height: 844 })
    for (const name of ['Knowledge', 'Bookings', 'Leads', 'Handover', 'Diagnostics', 'Setup']) {
        await page.getByRole('button', { name, exact: true }).click()
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `${name} overflows mobile viewport`)
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false)
    await page.screenshot({ path: path.join(directory, 'assistant-mobile.png'), fullPage: true })
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByText('Installed version').waitFor()
    await page.getByRole('button', { name: 'Update app', exact: true }).click()
    await page.getByText('Update to v1.2.0 was sent', { exact: false }).waitFor()
    assert.equal(updateRequested, true)
    const channels = [
        { id: 'first', displayName: 'Sales', displayPhone: '+91 90000 00001', connected: true, nameStatus: 'DECLINED' },
        { id: 'second', displayName: 'Sales', displayPhone: '+91 90000 00002', connected: true, cloudRegistered: true },
    ]
    let selected = 'first'
    await page.route('**/api/tools/wabix**', async route => {
        const pathname = new URL(route.request().url()).pathname
        if (pathname === '/api/tools/wabix/accounts/select') selected = route.request().postDataJSON().accountId
        const accounts = channels.map(account => ({ ...account, isSelected: account.id === selected }))
        await route.fulfill({ json: { status: {
            ...accounts.find(account => account.isSelected), accounts,
            oauthPath: '/tools/whatsapp', metaAppId: 'test-app', embeddedSignupConfigId: 'test-config', hasAppSecret: true,
        } } })
    })
    await page.route('https://connect.facebook.net/**', async route => {
        await route.fulfill({
            contentType: 'application/javascript',
            body: `window.FB = { init() {}, login(callback, options) { window.__fbLogin = options; callback({ status: 'unknown' }) } }; if (window.fbAsyncInit) window.fbAsyncInit()`,
        })
    })
    await page.goto(`http://127.0.0.1:${server.address().port}/#module`)
    await page.reload()
    await page.getByRole('heading', { name: 'Shared inbox', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Channels', exact: true }).click()
    await page.getByRole('heading', { name: 'Channels', exact: true }).waitFor()
    await page.getByRole('status').filter({ hasText: /^Name declined$/ }).waitFor()
    const channel = page.getByLabel('Active channel')
    assert.equal(await channel.inputValue(), 'first')
    assert.deepEqual(await channel.locator('option').allTextContents(), ['Select an account', 'Sales · +91 90000 00001', 'Sales · +91 90000 00002'])
    await channel.selectOption('second')
    await page.getByRole('status').filter({ hasText: /^Connected$/ }).waitFor()
    await page.getByRole('button', { name: 'Shared inbox', exact: true }).click()
    assert.equal(await page.getByLabel('Active account').inputValue(), 'second')
    assert.equal(await page.getByLabel('Inbox business number').inputValue(), 'all')
    await page.getByRole('button', { name: 'Channels', exact: true }).click()
    await page.locator('a[href="https://wa.me/919000000002"]').waitFor()
    await page.getByRole('link', { name: 'Download QR' }).waitFor()
    assert.equal(await page.getByRole('link', { name: 'Download QR' }).getAttribute('download'), 'whatsapp-919000000002.png')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false)
    await page.screenshot({ path: path.join(directory, 'channels-mobile.png'), fullPage: true })
    await page.getByRole('button', { name: 'Connect another number' }).click()
    await page.getByRole('alert').filter({ hasText: 'Meta did not finish onboarding' }).waitFor()
    const loginOptions = await page.evaluate(() => window.__fbLogin)
    assert.equal(loginOptions.config_id, 'test-config')
    assert.equal(loginOptions.response_type, 'code')
    assert.equal(loginOptions.override_default_response_type, true)
    const savedForms = []
    await page.route('**/api/tools/wabix/forms?**', route => route.fulfill({
        json: { forms: savedForms, deliveries: [], hubspot: { configured: true, portalId: '123' } },
    }))
    await page.route('**/api/tools/wabix/forms', async route => {
        const payload = route.request().postDataJSON()
        assert.equal(payload.accountId, 'second')
        assert.equal(payload.fields[0].target, 'email')
        savedForms.push({ ...payload, id: 'draft', metaFlowId: null, published: false })
        await route.fulfill({ json: savedForms[0] })
    })
    await page.getByRole('button', { name: 'Forms', exact: true }).click()
    await page.getByText('Connected to portal 123').waitFor()
    await page.getByLabel('Form name').fill('Callback request')
    await page.getByRole('button', { name: 'Save draft' }).click()
    await page.getByText('Draft saved.').waitFor()
    await page.getByText('Callback request', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false)
    assert.deepEqual(errors, [])
    console.log(`UI checks passed. Screenshots: ${directory}`)
} finally { await browser.close(); server.close() }
