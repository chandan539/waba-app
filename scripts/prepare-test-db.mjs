import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
const url = process.env.TEST_DATABASE_URL
if (!url || !/^waba_test/.test(new URL(url).pathname.slice(1))) throw new Error('Set TEST_DATABASE_URL to a disposable Postgres database named waba_test…')
const directory = path.resolve('node_modules/.cache/waba')
await mkdir(directory, { recursive: true })
const schema = `generator client {\n provider = "prisma-client-js"\n output = "../../.prisma/client"\n}\ndatasource db {\n provider = "postgresql"\n url = env("TEST_DATABASE_URL")\n}\n` + await readFile('prisma/schema.prisma', 'utf8')
const schemaPath = path.join(directory, 'schema.prisma')
await writeFile(schemaPath, schema)
execFileSync('node_modules/.bin/prisma', ['generate', '--schema', schemaPath], { stdio: 'inherit' })
execFileSync('node_modules/.bin/prisma', ['db', 'push', '--schema', schemaPath, '--skip-generate'], { stdio: 'inherit' })
