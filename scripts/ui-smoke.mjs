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
await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {WabaBoard} from './src/components/WabaBoard'; createRoot(document.getElementById('root')).render(<WabaBoard/>);`, resolveDir: process.cwd(), loader: 'tsx' }, jsx: 'automatic', bundle: true, platform: 'browser', outfile: path.join(directory, 'app.js') })
await writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body style="margin:0;background:#f7f9fc;padding:16px"><div id="root"></div><script src="/app.js"></script></body></html>')
const server = createServer(async (req, res) => { try { const name = req.url === '/' ? 'index.html' : req.url.slice(1); if (!['index.html', 'app.js', 'style.css'].includes(name)) { res.writeHead(404).end(); return } res.setHeader('content-type', name.endsWith('.js') ? 'application/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html'); res.end(await readFile(path.join(directory, name))) } catch { res.writeHead(404).end() } })
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
    assert.deepEqual(errors, [])
    console.log(`UI checks passed. Screenshots: ${directory}`)
} finally { await browser.close(); server.close() }
