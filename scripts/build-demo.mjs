import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'

await mkdir('dist/demo', { recursive: true })
await writeFile('dist/demo/input.css', '@import "tailwindcss" source(none);\n@source "../../src/components";\n@source "../../demo";\n')
execFileSync('node_modules/.bin/tailwindcss', ['-i', 'dist/demo/input.css', '-o', 'dist/demo/style.css', '--minify'], { stdio: 'inherit' })
await build({ entryPoints: ['demo/main.tsx'], outfile: 'dist/demo/app.js', bundle: true, minify: true, jsx: 'automatic', platform: 'browser' })
await writeFile('dist/demo/index.html', '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Wabix AI · WhatsApp workspace demo</title><link rel="stylesheet" href="/style.css"></head><body class="bg-[#f7f9fc] p-3 text-slate-900 sm:p-5"><div id="root"></div><script src="/app.js" defer></script></body></html>')

await mkdir('dist/demo/samples', { recursive: true })
const { default: sharp } = await import('sharp')
await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="260"><rect width="480" height="260" fill="#00685d"/><text x="36" y="115" fill="white" font-size="30" font-family="sans-serif">Wabix AI</text><text x="36" y="160" fill="white" font-size="20" font-family="sans-serif">Sample WhatsApp attachment</text></svg>')).png().toFile('dist/demo/samples/sample-image.png')
const stream = 'BT /F1 22 Tf 50 750 Td (Wabix AI - Sample project brief) Tj ET\n'
const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
]
let pdf = '%PDF-1.4\n'
const offsets = objects.map((object, i) => {
    const offset = pdf.length
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`
    return offset
})
const xref = pdf.length
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
await writeFile('dist/demo/samples/sample-brief.pdf', pdf)
