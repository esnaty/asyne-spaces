import { Router } from 'express'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

export const callbackPath = '/api/pinterest/callback'
const cookieName = 'asyne_pinterest_oauth'
const scopes = ['boards:read', 'user_accounts:read']
const hash = value => createHash('sha256').update(value).digest('hex')
const issue = (message, status = 400) => Object.assign(new Error(message), { status })

export function pinterestRouter(pool, { env = process.env, fetchImpl = fetch } = {}) {
  const router = Router()
  const redirectUri = env.PINTEREST_REDIRECT_URI || `http://localhost:5180${callbackPath}`
  const missing = ['PINTEREST_APP_ID', 'PINTEREST_APP_SECRET', 'PINTEREST_TOKEN_KEY'].filter(name => !env[name])
  let redirect
  try { redirect = new URL(redirectUri) } catch {}
  const validRedirect = redirect && ['http:', 'https:'].includes(redirect.protocol) &&
    ['localhost', '127.0.0.1', '[::1]'].includes(redirect.hostname) && redirect.pathname === callbackPath &&
    !redirect.username && !redirect.password && !redirect.search && !redirect.hash
  const key = /^[a-f0-9]{64}$/i.test(env.PINTEREST_TOKEN_KEY || '') ? Buffer.from(env.PINTEREST_TOKEN_KEY, 'hex') : null
  const configured = missing.length === 0 && !!key && !!validRedirect
  const fingerprint = hash(`${env.PINTEREST_APP_ID}:${redirectUri}`)
  const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: redirect?.protocol === 'https:', path: callbackPath }
  const requireConfig = () => { if (!configured) throw issue('Completa la configuración de Pinterest en el servidor.', 503) }
  function encrypt(data) {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    cipher.setAAD(Buffer.from(fingerprint))
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(data)), cipher.final()])
    return [iv, cipher.getAuthTag(), ciphertext].map(part => part.toString('base64')).join('.')
  }
  function decrypt(value) {
    const [iv, tag, ciphertext] = value.split('.').map(part => Buffer.from(part, 'base64'))
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAAD(Buffer.from(fingerprint))
    decipher.setAuthTag(tag)
    return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString())
  }
  router.get('/status', async (req, res) => {
    const { rows: [connection] } = await pool.query('SELECT * FROM pinterest_connection WHERE id = 1')
    let readable = false
    if (configured && connection?.fingerprint === fingerprint) {
      try { decrypt(connection.tokens); readable = true } catch {}
    }
    const connected = readable && new Date(connection.expires_at).getTime() > Date.now()
    res.json({ configured, missing, redirectUri, scopes, connected,
      needsReconnect: !!connection && !connected,
      username: readable ? connection.username : null,
      expiresAt: readable ? connection.expires_at : null })
  })
  router.post('/connect', async (req, res) => {
    requireConfig()
    // Keep cookie and callback on the same canonical host.
    if (req.hostname !== redirect.hostname) throw issue(`Abre AsyneStudio en ${redirect.origin} para conectar Pinterest.`)
    const state = randomBytes(32).toString('hex')
    const browser = randomBytes(32).toString('hex')
    await pool.query('DELETE FROM pinterest_oauth_states WHERE expires_at < now()')
    await pool.query(`INSERT INTO pinterest_oauth_states (state_hash, browser_hash, expires_at)
      VALUES ($1, $2, now() + interval '10 minutes')`, [hash(state), hash(browser)])
    res.cookie(cookieName, browser, { ...cookieOptions, maxAge: 600000 })
    const url = new URL('https://www.pinterest.com/oauth/')
    url.search = new URLSearchParams({ client_id: env.PINTEREST_APP_ID, redirect_uri: redirectUri,
      response_type: 'code', scope: scopes.join(','), state }).toString()
    res.json({ url: url.href })
  })
  router.get('/callback', async (req, res) => {
    res.set('Referrer-Policy', 'no-referrer')
    res.clearCookie(cookieName, cookieOptions)
    const finish = result => res.redirect(303, `/?pinterest=${result}`)
    const browser = (req.get('cookie') || '').split(';').map(item => item.trim()).find(item => item.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1)
    if (!configured || !/^[a-f0-9]{64}$/.test(browser || '') || typeof req.query.state !== 'string' || !/^[a-f0-9]{64}$/.test(req.query.state)) return finish('invalid_state')
    const consumed = await pool.query(`DELETE FROM pinterest_oauth_states
      WHERE state_hash = $1 AND browser_hash = $2 AND expires_at > now() RETURNING state_hash`, [hash(req.query.state), hash(browser)])
    if (!consumed.rowCount) return finish('invalid_state')
    if (req.query.error) return finish('denied')
    if (typeof req.query.code !== 'string' || !req.query.code || req.query.code.length > 4096) return finish('failed')
    try {
      const response = await fetchImpl('https://api.pinterest.com/v5/oauth/token', {
        method: 'POST', signal: AbortSignal.timeout(10000),
        headers: { Authorization: `Basic ${Buffer.from(`${env.PINTEREST_APP_ID}:${env.PINTEREST_APP_SECRET}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code: req.query.code, redirect_uri: redirectUri }),
      })
      if (!response.ok) return finish('failed')
      const tokens = await response.json()
      if (typeof tokens.access_token !== 'string' || !tokens.access_token || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0) return finish('failed')
      const granted = typeof tokens.scope === 'string' ? tokens.scope.split(/[ ,]+/) : []
      if (!scopes.every(scope => granted.includes(scope))) return finish('permissions')
      const accountResponse = await fetchImpl('https://api.pinterest.com/v5/user_account', {
        signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${tokens.access_token}` },
      })
      if (!accountResponse.ok) return finish('failed')
      const account = await accountResponse.json()
      if (typeof account.username !== 'string' || !account.username) return finish('failed')
      await pool.query(`INSERT INTO pinterest_connection (id, tokens, username, expires_at, fingerprint)
        VALUES (1, $1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET
        tokens = EXCLUDED.tokens, username = EXCLUDED.username, expires_at = EXCLUDED.expires_at,
        fingerprint = EXCLUDED.fingerprint`, [encrypt(tokens), account.username, new Date(Date.now() + tokens.expires_in * 1000), fingerprint])
      return finish('connected')
    } catch {
      // Never log provider responses, codes, tokens or request URLs.
      return finish('failed')
    }
  })
  router.post('/disconnect', async (req, res) => {
    await pool.query('DELETE FROM pinterest_connection')
    await pool.query('DELETE FROM pinterest_oauth_states')
    res.clearCookie(cookieName, cookieOptions)
    res.json({ disconnected: true })
  })
  return router
}
