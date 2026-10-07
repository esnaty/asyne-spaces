import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { randomBytes } from 'node:crypto'
import { createApp } from '../app.js'
import { createPool, initializeDatabase } from '../db.js'

const schema = `oauth_test_${Date.now()}_${process.pid}`
const admin = createPool()
const pool = createPool({ options: `-c search_path=${schema}` })
const env = { PINTEREST_REDIRECT_URI: 'http://127.0.0.1:5180/api/pinterest/callback', PINTEREST_APP_ID: 'test-app', PINTEREST_APP_SECRET: 'test-secret', PINTEREST_TOKEN_KEY: randomBytes(32).toString('hex') }
let server, base, providerCalls = 0, providerMode = 'ok'
const tokens = { access_token: 'private-access-token', refresh_token: 'private-refresh-token', expires_in: 3600, scope: 'boards:read user_accounts:read' }
async function provider(url, options) {
  providerCalls++
  if (providerMode === 'timeout') throw new Error('provider secret that must not leak')
  if (providerMode === 'failure') return new Response('{}', { status: 401 })
  if (url.endsWith('/oauth/token')) {
    assert.equal(options.body.get('redirect_uri'), 'http://127.0.0.1:5180/api/pinterest/callback')
    assert.equal(options.body.get('grant_type'), 'authorization_code')
    return Response.json({ ...tokens, ...(providerMode === 'permissions' ? { scope: 'boards:read' } : {}) })
  }
  assert.equal(url, 'https://api.pinterest.com/v5/user_account')
  assert.equal(options.headers.Authorization, `Bearer ${tokens.access_token}`)
  return Response.json({ username: 'test-account' })
}
async function start(config = env) {
  server = createApp(pool, { pinterest: { env: config, fetchImpl: provider } }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  base = `http://127.0.0.1:${server.address().port}/api/pinterest`
}
before(async () => { await admin.query(`CREATE SCHEMA ${schema}`); await initializeDatabase(pool); await start() })
after(async () => { await new Promise(resolve => server.close(resolve)); await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end() })
async function call(path, { method = 'GET', cookie, cross = false } = {}) {
  return fetch(base + path, { method, redirect: 'manual', headers: { Host: 'localhost',
    ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
    ...(cookie ? { Cookie: cookie } : {}), ...(cross ? { 'Sec-Fetch-Site': 'cross-site' } : {}) },
    ...(method === 'POST' ? { body: '{}' } : {}) })
}
async function begin() {
  const response = await call('/connect', { method: 'POST' })
  assert.equal(response.status, 200)
  const cookie = response.headers.get('set-cookie')
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Lax/)
  const { url } = await response.json()
  const auth = new URL(url)
  assert.equal(auth.origin, 'https://www.pinterest.com')
  assert.equal(auth.searchParams.get('scope'), 'boards:read,user_accounts:read')
  assert.equal(url.includes('test-secret'), false)
  return { cookie: cookie.split(';')[0], state: auth.searchParams.get('state') }
}
const callback = (session, extra = 'code=test-code') => call(`/callback?state=${session.state}&${extra}`, { cookie: session.cookie, cross: true })

test('OAuth validates browser, consumes state once and persists encrypted tokens across restart', async () => {
  const session = await begin()
  const wrongBrowser = await callback({ ...session, cookie: 'asyne_pinterest_oauth=' + 'a'.repeat(64) })
  assert.equal(wrongBrowser.headers.get('location'), '/?pinterest=invalid_state')
  assert.equal(providerCalls, 0)
  const success = await callback(session)
  assert.equal(success.status, 303)
  assert.equal(success.headers.get('location'), '/?pinterest=connected')
  assert.equal((await callback(session)).headers.get('location'), '/?pinterest=invalid_state')
  assert.equal(providerCalls, 2)
  const stored = (await pool.query('SELECT * FROM pinterest_connection')).rows[0]
  assert.ok(stored.tokens)
  assert.equal(stored.tokens.includes(tokens.access_token), false)
  assert.equal(stored.tokens.includes(tokens.refresh_token), false)
  await new Promise(resolve => server.close(resolve)); await start()
  const status = await (await call('/status')).json()
  assert.equal(status.connected, true); assert.equal(status.username, 'test-account')
  assert.equal(JSON.stringify(status).includes('private-'), false)
  assert.equal(JSON.stringify(status).includes('test-secret'), false)
})
test('denial, expiry, provider errors and missing permissions preserve saved connection', async () => {
  const original = (await pool.query('SELECT tokens FROM pinterest_connection')).rows[0].tokens
  assert.equal((await callback(await begin(), 'error=access_denied')).headers.get('location'), '/?pinterest=denied')
  const expired = await begin()
  await pool.query("UPDATE pinterest_oauth_states SET expires_at = now() - interval '1 second'")
  assert.equal((await callback(expired)).headers.get('location'), '/?pinterest=invalid_state')
  for (const mode of ['failure', 'timeout', 'permissions']) {
    providerMode = mode
    assert.equal((await callback(await begin())).headers.get('location'), `/?pinterest=${mode === 'permissions' ? 'permissions' : 'failed'}`)
  }
  providerMode = 'ok'
  assert.equal((await pool.query('SELECT tokens FROM pinterest_connection')).rows[0].tokens, original)
})
test('foreign origins blocked except callback; expired connection requires reconnect; disconnect deletes secrets', async () => {
  assert.equal((await call('/connect', { method: 'POST', cross: true })).status, 403)
  assert.equal((await call('/disconnect', { method: 'POST', cross: true })).status, 403)
  assert.equal((await call('/status', { cross: true })).status, 403)
  await pool.query("UPDATE pinterest_connection SET expires_at = now() - interval '1 second'")
  const expired = await (await call('/status')).json()
  assert.equal(expired.connected, false); assert.equal(expired.needsReconnect, true)
  assert.equal((await call('/disconnect', { method: 'POST' })).status, 200)
  assert.equal((await pool.query('SELECT * FROM pinterest_connection')).rowCount, 0)
  assert.equal((await pool.query('SELECT * FROM pinterest_oauth_states')).rowCount, 0)
})
test('missing configuration is clearly disabled without leaking keys', async () => {
  await new Promise(resolve => server.close(resolve)); await start({})
  const status = await (await call('/status')).json()
  assert.equal(status.configured, false)
  assert.ok(status.missing.includes('PINTEREST_APP_SECRET'))
  assert.equal((await call('/connect', { method: 'POST' })).status, 503)
})
