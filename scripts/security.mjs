import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { loadEnvFile } from 'node:process'

loadEnvFile('.env.local')
const secret = process.env.YOUTUBE_API_KEY
if (!secret) throw new Error('Local YouTube key is missing.')
const origin = process.env.MYTUBE_TEST_ORIGIN ?? 'http://127.0.0.1:4173'
async function checkTree(root) {
  for (const item of await readdir(root, { withFileTypes: true })) {
    const path = join(root, item.name)
    if (item.isDirectory()) await checkTree(path)
    else if ((await readFile(path)).includes(secret)) throw new Error('A public artifact contains the local secret.')
  }
}
await checkTree('dist/client')
for (const [path, expected, mime] of [
  ['/', 200, 'text/html'], ['/watch?v=EE_FNROtzQM', 200, 'text/html'],
  ['/api/video?id=EE_FNROtzQM', 200, 'application/json'], ['/api/video?id=bad', 400, 'application/json'],
  ['/api/unknown', 404, 'application/json'], ['/api', 404, 'application/json'], ['/.env.local', 404], ['/.dev.vars', 404],
]) {
  const response = await fetch(new URL(path, origin))
  const text = await response.text()
  if (response.status !== expected || (mime && !response.headers.get('content-type')?.includes(mime)) || text.includes(secret))
    throw new Error('Unexpected public routing or secret check result.')
}
console.log('Public assets, HTML, API responses, invalid inputs and secret paths passed.')
