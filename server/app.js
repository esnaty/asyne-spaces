import express from 'express'
import { pinColumns } from './db.js'
import { callbackPath, pinterestRouter } from './pinterest.js'
import { draftsRouter } from './drafts.js'
import { collectionsRouter } from './collections.js'


const fields = {
  title: ['title', 100, true], description: ['description', 5000],
  product: ['product', 300], asin: ['asin', 10], alt: ['alt', 1000],
  affiliateUrl: ['affiliate_url', 2048], board: ['board', 200],
  collection: ['collection_id', 100, true], status: ['status', 20, true],
  scheduledAt: ['scheduled_at'],
  image: ['image', 500], notes: ['notes', 5000], prompt: ['prompt', 12000], kind: ['kind', 20, true],
}
const statuses = ['draft', 'ready', 'approved', 'published', 'discarded']
const fail = (message, status = 400) => Object.assign(new Error(message), { status })

function validate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail('Envía un objeto JSON.')
  if (!Number.isSafeInteger(body.version) || body.version < 1) throw fail('La versión del pin es obligatoria.')
  const entries = Object.entries(body).filter(([key]) => key !== 'version')
  if (!entries.length) throw fail('No hay cambios para guardar.')
  return entries.map(([key, value]) => {
    if (!Object.hasOwn(fields, key)) throw fail(`Campo no editable: ${key}.`)
    const spec = fields[key]
    if (key === 'scheduledAt') {
      if (value !== null) {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
          throw fail('La fecha prevista debe incluir la zona horaria o ser null.')
        }
        const day = value.slice(0, 10)
        if (new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) throw fail('La fecha prevista no es válida.')
      }
      return [spec[0], value]
    }
    if (typeof value !== 'string') throw fail(`El campo ${key} debe ser texto.`)
    value = value.trim()
    if (value.length > spec[1] || (spec[2] && !value)) throw fail(`Revisa la longitud del campo ${key}.`)
    if (key === 'image' && value && !/^\/(media|assets)\/[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp)$/i.test(value)) throw fail('Usa una imagen local PNG, JPEG o WebP.')
    if (key === 'kind' && !['base', 'product'].includes(value)) throw fail('Tipo de pin no válido.')
    if (key === 'status' && !statuses.includes(value)) throw fail('Estado no válido.')
    if (key === 'asin' && value && !/^[A-Z0-9]{10}$/.test(value)) throw fail('El ASIN debe tener 10 letras mayúsculas o números.')
    if (key === 'affiliateUrl' && value) {
      let url
      try { url = new URL(value) } catch { throw fail('El enlace debe ser una URL válida.') }
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw fail('Usa un enlace http o https sin credenciales.')
    }
    return [spec[0], value]
  })
}

export function createApp(pool, { pinterest, allowedOrigins = ['http://localhost:5180', 'http://127.0.0.1:5180', 'http://localhost:5173', 'http://127.0.0.1:5173'] } = {}) {
  const app = express()
  app.disable('x-powered-by')
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store')
    if (!['localhost', '127.0.0.1', '[::1]'].includes(req.hostname)) return next(fail('Host no permitido.', 403))
    // Local-only app: reject requests initiated by an unrelated website.
    const oauthCallback = req.method === 'GET' && req.originalUrl.split('?')[0] === callbackPath
    if (!oauthCallback && (req.get('sec-fetch-site') === 'cross-site' || (req.get('origin') && !allowedOrigins.includes(req.get('origin'))))) {
      return next(fail('Origen no permitido.', 403))
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !req.is('application/json')) return next(fail('Usa application/json.', 415))
    next()
  })
  app.use('/api/reference-images', express.json({ limit: '12mb' }))
  app.use('/api/weekly-drafts', express.json({ limit: '256kb' }))
  app.use(express.json({ limit: '32kb' }))
  app.use('/api/pinterest', pinterestRouter(pool, pinterest))
  app.use('/api', draftsRouter(pool))
  app.use('/api', collectionsRouter(pool))

  app.get('/api/health', async (req, res) => {
    await pool.query('SELECT 1')
    res.json({ status: 'ok', database: 'connected' })
  })
  app.get('/api/pins', async (req, res) => {
    const { rows } = await pool.query(`SELECT ${pinColumns} FROM pins ORDER BY id`)
    res.json(rows)
  })
  app.param('id', (req, res, next, id) => {
    if (!/^[1-9]\d*$/.test(id) || Number(id) > 2147483647) return next(fail('Identificador no válido.'))
    next()
  })
  app.get('/api/pins/:id', async (req, res) => {
    const { rows } = await pool.query(`SELECT ${pinColumns} FROM pins WHERE id = $1`, [req.params.id])
    if (!rows.length) throw fail('No se encontró el pin.', 404)
    res.json(rows[0])
  })
  app.patch('/api/pins/:id', async (req, res) => {
    const updates = validate(req.body)
    const values = updates.map(([, value]) => value)
    const assignments = updates.map(([column], index) => `${column} = $${index + 1}`)
    values.push(req.params.id, req.body.version)
    const { rows } = await pool.query(`UPDATE pins SET ${assignments.join(', ')},
      version = version + 1, updated_at = now()
      WHERE id = $${values.length - 1} AND version = $${values.length}
      RETURNING ${pinColumns}`, values)
    if (!rows.length) {
      const exists = await pool.query('SELECT id FROM pins WHERE id = $1', [req.params.id])
      if (!exists.rowCount) throw fail('No se encontró el pin.', 404)
      throw fail('Este pin cambió en otra ventana. Recarga su ficha antes de guardar.', 409)
    }
    res.json(rows[0])
  })
  app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }))
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error)
    if (error.code === '23503') return res.status(400).json({ error: 'La colección seleccionada no existe.' })
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON no válido.' })
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'El contenido es demasiado grande.' })
    const status = error.status || 500
    if (status >= 500) console.error('API request failed:', error.code || error.name)
    res.status(status).json({ error: status >= 500 ? 'No se pudo acceder a los datos. Inténtalo de nuevo.' : error.message })
  })
  return app
}


