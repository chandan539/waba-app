import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'

await mkdir('dist/demo', { recursive: true })
await writeFile('dist/demo/input.css', '@import "tailwindcss" source(none);\n@source "../../src/components";\n@source "../../demo";\n')
execFileSync('node_modules/.bin/tailwindcss', ['-i', 'dist/demo/input.css', '-o', 'dist/demo/style.css', '--minify'], { stdio: 'inherit' })
await build({ entryPoints: ['demo/main.tsx'], outfile: 'dist/demo/app.js', bundle: true, minify: true, jsx: 'automatic', platform: 'browser' })
await writeFile('dist/demo/index.html', '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Wabix AI · WhatsApp workspace demo</title><link rel="stylesheet" href="/style.css"></head><body class="bg-[#f7f9fc] p-3 text-slate-900 sm:p-5"><div id="root"></div><script src="/app.js" defer></script></body></html>')
