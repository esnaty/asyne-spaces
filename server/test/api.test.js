import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import http from 'node:http'
import { createApp } from '../app.js'
import { createPool, initializeDatabase } from '../db.js'

// Isolated schema: tests never modify the real editorial collections.
const schema = `test_${Date.now()}_${process.pid}`
const admin = createPool()
const pool = createPool({ options: `-c search_path=${schema}` })
let server
let base
before(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`)
  await initializeDatabase(pool)
  server = createApp(pool).listen(0, '127.0.0.1')
  await once(server, 'listening')
  base = `http://127.0.0.1:${server.address().port}/api`
})
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve))
  await pool.end()
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
  await admin.end()
})
async function request(path, body, headers = {}) {
  const response = await fetch(base + path, body === undefined ? { headers } : {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  })
  return { status: response.status, data: await response.json() }
}

test('subboard preparation persists, rejects stale edits and invalid references', async () => {
  const original = (await request('/collections')).data[0]
  const body = { ...original, boardName: 'Hogar', prompt: 'Escena con referencias exactas', referenceImages: [{ name: 'Producto', image: '/media/producto.png', asin: 'B0FGPCG599', sourceUrl: 'https://www.amazon.es/dp/B0FGPCG599' }] }
  const saved = await request(`/collections/${original.id}`, body)
  assert.equal(saved.status, 200)
  assert.equal(saved.data.prompt, body.prompt)
  assert.deepEqual(saved.data.referenceImages, body.referenceImages)
  assert.equal((await request(`/collections/${original.id}`, body)).status, 409)
  assert.equal((await request(`/collections/${original.id}`, { ...saved.data, referenceImages: [{ name: 'Bad', image: 'https://example.com/a.png' }] })).status, 400)
  await initializeDatabase(pool)
  assert.deepEqual((await request('/collections')).data.find(c => c.id === original.id), saved.data)
})

test('loads health, two collections and ten initial pins', async () => {
  assert.equal((await request('/health')).data.database, 'connected')
  assert.equal((await request('/collections')).data.length, 2)
  const { data } = await request('/pins')
  assert.equal(data.length, 10)
  assert.equal(data[0].status, 'draft')
})

test('weekly drafts persist incomplete ideas, retries preserve human edits and removed OpenAI is unavailable', async () => {
  const body = { batchKey: '2026-09-21-test', collection: { name: 'Ideas semanales' }, pins: [
    { key: '01-idea', kind: 'base', prompt: 'Escena completa de entrada', title: 'Entrada acogedora', notes: 'Pendiente producto e imagen' },
    { key: '02-idea', title: 'Una zona de lectura', image: '/media/2026-09-21-lectura.png' },
  ] }
  const submit = value => fetch(base + '/weekly-drafts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) })
  const first = await submit(body)
  assert.equal(first.status, 200)
  const data = await first.json()
  assert.equal(data.pins.length, 2)
  const id = data.pins[0].id
  assert.equal((await request(`/pins/${id}`)).data.kind, 'base')
  assert.equal((await request(`/pins/${id}`)).data.prompt, 'Escena completa de entrada')
  assert.equal((await request(`/pins/${id}`, { version: 1, kind: 'invalid' })).status, 400)
  assert.equal((await request(`/pins/${id}`, { version: 1, prompt: 'x'.repeat(12001) })).status, 400)
  assert.equal((await request(`/pins/${id}`)).data.status, 'draft')
  const edited = await request(`/pins/${id}`, { version: 1, title: 'Revisado por mí', status: 'approved', asin: '', product: '' })
  assert.equal(edited.status, 200)
  await initializeDatabase(pool)
  const repeated = await (await submit(body)).json()
  assert.ok(repeated.pins.every(pin => !pin.created))
  assert.equal((await request(`/pins/${id}`)).data.title, 'Revisado por mí')
  assert.equal((await request(`/pins/${id}`)).data.status, 'approved')
  assert.equal((await submit({ ...body, pins: [{ key: 'bad', title: '' }] })).status, 400)
  assert.equal((await request('/openai/status')).status, 404)
  // Clean only this test's additions in the isolated schema.
  await pool.query('DELETE FROM pins WHERE collection_id = $1', [body.batchKey])
  await pool.query('DELETE FROM collections WHERE id = $1', [body.batchKey])
})

test('persists all editorial fields, converts time zones, and preserves changes on initialization', async () => {
  const original = (await request('/pins/1')).data
  const changes = {
    version: original.version, image: '/media/prueba-pin.png', prompt: 'Acerca la cámara al producto de referencia', kind: 'product', title: 'Café y calma', description: "Una mañana tranquila; 'SELECT' es solo texto.",
    collection: 'dormitorio', product: 'Producto editado', asin: 'B0FGPCG599',
    alt: 'Una taza de café', affiliateUrl: 'https://www.amazon.es/dp/B0FGPCG599?tag=ejemplo-21',
    board: 'Ideas para casa', scheduledAt: '2026-09-20T10:30:00+02:00', status: 'approved',
  }
  const updated = await request('/pins/1', changes)
  assert.equal(updated.status, 200)
  assert.equal(updated.data.version, original.version + 1)
  assert.equal(updated.data.scheduledAt, '2026-09-20T08:30:00.000Z')
  assert.equal(updated.data.image, changes.image)
  for (const key of Object.keys(changes).filter(key => !['version', 'scheduledAt'].includes(key))) assert.equal(updated.data[key], changes[key])
  await initializeDatabase(pool)
  assert.deepEqual((await request('/pins/1')).data, updated.data)
  const independentPool = createPool({ options: `-c search_path=${schema}` })
  try { assert.equal((await independentPool.query('SELECT title FROM pins WHERE id = 1')).rows[0].title, changes.title) }
  finally { await independentPool.end() }
})

test('rejects stale writes and allows only one concurrent edit', async () => {
  const pin = (await request('/pins/2')).data
  const results = await Promise.all([
    request('/pins/2', { version: pin.version, status: 'ready' }),
    request('/pins/2', { version: pin.version, status: 'approved' }),
  ])
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409])
  assert.equal((await request('/pins/2')).data.version, pin.version + 1)
})

test('invalid edits leave the original record untouched', async () => {
  const pin = (await request('/pins/3')).data
  const invalid = [
    { title: '' }, { title: 'x'.repeat(101) }, { title: 42 }, { status: 'scheduled' },
    { asin: 'bad' }, { affiliateUrl: 'javascript:alert(1)' }, { affiliateUrl: 'https://user:pass@example.com' },
    { scheduledAt: '2026-09-20T10:30' }, { scheduledAt: '2026-02-30T10:30:00Z' },
    { collection: 'missing' }, { image: '/other.png' }, { constructor: 'bad' }, { version: -1, title: 'No' },
  ]
  for (const body of invalid) {
    const result = await request('/pins/3', { version: pin.version, ...body })
    assert.equal(result.status, 400, JSON.stringify(body))
  }
  assert.equal((await request('/pins/3', { title: 'No version' })).status, 400)
  assert.equal((await request('/pins/3', [])).status, 400)
  assert.deepEqual((await request('/pins/3')).data, pin)
})

test('allows clearing optional fields and changing all four states', async () => {
  let pin = (await request('/pins/4')).data
  for (const status of ['ready', 'approved', 'published', 'draft']) {
    const result = await request('/pins/4', { version: pin.version, status, scheduledAt: null, board: '', affiliateUrl: '' })
    assert.equal(result.status, 200)
    pin = result.data
    assert.equal(pin.status, status)
    assert.equal(pin.scheduledAt, null)
  }
})

test('handles missing records, malformed input and foreign origins', async () => {
  assert.equal((await request('/pins/9999')).status, 404)
  assert.equal((await request('/pins/9999', { version: 1, title: 'Missing' })).status, 404)
  assert.equal((await request('/pins/nope')).status, 400)
  assert.equal((await request('/pins/999999999999')).status, 400)
  assert.equal((await request('/missing')).status, 404)
  assert.equal((await request('/pins', undefined, { Origin: 'https://other.example' })).status, 403)
  assert.equal((await request('/pins', undefined, { 'Sec-Fetch-Site': 'cross-site' })).status, 403)
  const foreignHost = await new Promise((resolve, reject) => {
    http.get(base + '/pins', { headers: { Host: 'other.example' } }, response => { response.resume(); resolve(response.statusCode) }).on('error', reject)
  })
  assert.equal(foreignHost, 403)
  assert.equal((await request('/pins', undefined, { Origin: 'http://localhost:5180' })).status, 200)
  const malformed = await fetch(base + '/pins/1', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{' })
  assert.equal(malformed.status, 400)
  const wrongType = await fetch(base + '/pins/1', { method: 'PATCH', body: 'text' })
  assert.equal(wrongType.status, 415)
  const tooLarge = await request('/pins/1', { version: 1, description: 'x'.repeat(40000) })
  assert.equal(tooLarge.status, 413)
})


test('upgrades the previous status constraint and preserves discarded content across initialization', async () => {
  await pool.query("ALTER TABLE pins DROP CONSTRAINT pins_status_check_v2")
  await pool.query("ALTER TABLE pins ADD CONSTRAINT pins_status_check CHECK (status IN ('draft', 'ready', 'approved', 'published'))")
  const original = (await request('/pins/5')).data
  await initializeDatabase(pool)
  assert.deepEqual((await request('/pins/5')).data, original)
  const discarded = await request('/pins/5', { version: original.version, status: 'discarded' })
  assert.equal(discarded.status, 200)
  assert.equal(discarded.data.status, 'discarded')
  for (const key of Object.keys(original).filter(key => !['status', 'version', 'updatedAt'].includes(key))) {
    assert.deepEqual(discarded.data[key], original[key])
  }
  await initializeDatabase(pool)
  assert.deepEqual((await request('/pins/5')).data, discarded.data)
  assert.equal((await request('/pins')).data.length, 10)
  assert.equal((await request('/pins/5', { version: original.version, status: 'draft' })).status, 409)
  const restored = await request('/pins/5', { version: discarded.data.version, status: 'draft' })
  assert.equal(restored.status, 200)
  assert.equal(restored.data.status, 'draft')
  assert.equal(restored.data.title, original.title)
  assert.equal(restored.data.image, original.image)
})


