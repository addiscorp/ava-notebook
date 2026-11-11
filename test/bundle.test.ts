// The built bundle (run after `vite build`): fonts are files in it, nothing
// is fetched from a font CDN, and the manifest Ava reads is there.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const dist = join(import.meta.dirname, '..', 'dist')

test('the bundle has its manifest, its page and local fonts only', () => {
  assert.ok(existsSync(join(dist, 'manifest.json')), 'run npm run build first')
  const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'))
  assert.equal(manifest.id, 'notebook')
  assert.deepEqual(manifest.egress, [], 'Notebook reaches no host')
  const assets = readdirSync(join(dist, 'assets'))
  assert.ok(assets.some(f => f.startsWith('comfortaa-') && f.endsWith('.woff2')), 'Comfortaa is bundled')
  assert.ok(assets.some(f => f.startsWith('dm-sans-')), 'DM Sans is bundled')
  assert.ok(assets.some(f => f.startsWith('ibm-plex-mono-')), 'IBM Plex Mono is bundled')
  for (const f of ['index.html', ...assets.filter(a => /\.(css|js|html)$/.test(a)).map(a => join('assets', a))]) {
    const text = readFileSync(join(dist, f), 'utf8')
    assert.ok(!/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(text), `${f} reaches Google Fonts`)
    assert.ok(!/url\(\s*["']?data:font/.test(text), `${f} inlines a font as data: (the add-on CSP refuses those)`)
  }
})
