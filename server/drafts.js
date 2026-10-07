import { Router } from 'express'
import { validateReferences } from './collections.js'
const bad = message => Object.assign(new Error(message), { status: 400 })
export function draftsRouter(pool) {
  const router = Router()
  router.post('/weekly-drafts', async (req, res) => {
    const { batchKey, collection, pins } = req.body || {}
    if (typeof batchKey !== 'string' || !/^[a-z0-9-]{1,100}$/.test(batchKey)) throw bad('batchKey no válido.')
    if (!collection || typeof collection.name !== 'string' || !collection.name.trim() || collection.name.length > 200) throw bad('Nombre de colección no válido.')
    const boardName = collection.boardName ?? '', prompt = collection.prompt ?? ''
    if (typeof boardName !== 'string' || boardName.length > 200 || typeof prompt !== 'string' || prompt.length > 12000) throw bad('Tablero o prompt no válido.')
    const refs = validateReferences(collection.referenceImages ?? [])
    if (!Array.isArray(pins) || !pins.length || pins.length > 16) throw bad('Envía entre 1 y 16 borradores.')
    const keys = new Set()
    const clean = pins.map(pin => {
      if (!pin || typeof pin.key !== 'string' || !/^[a-z0-9-]{1,100}$/.test(pin.key) || keys.has(pin.key)) throw bad('Cada pin necesita una key única y estable.')
      keys.add(pin.key)
      const data = { key: pin.key, kind: pin.kind ?? 'product' }
      if (!['base', 'product'].includes(data.kind)) throw bad('Tipo de pin no válido.')
      for (const [field, max] of Object.entries({ title: 100, description: 5000, product: 300, asin: 10, affiliateUrl: 2048, board: 200, image: 500, alt: 1000, notes: 5000, prompt: 12000 })) {
        const value = pin[field] ?? ''
        if (typeof value !== 'string' || value.length > max) throw bad(`Revisa ${field}.`)
        data[field] = value.trim()
      }
      if (!data.title) throw bad('El título es obligatorio.')
      if (data.asin && !/^[A-Z0-9]{10}$/.test(data.asin)) throw bad('ASIN no válido.')
      if (data.image && !/^\/(media|assets)\/[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp)$/i.test(data.image)) throw bad('La imagen debe ser un archivo local en /media/ o /assets/.')
      if (data.affiliateUrl) {
        let url
        try { url = new URL(data.affiliateUrl) } catch { throw bad('Enlace no válido.') }
        if (url.protocol !== 'https:' || url.username || url.password) throw bad('Usa un enlace https sin credenciales.')
      }
      return data
    })
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(51803001)')
      await client.query('INSERT INTO collections (id,name,short_name,board_name,prompt,reference_images) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING', [batchKey, collection.name.trim(), collection.name.trim().slice(0,60), boardName.trim(), prompt, JSON.stringify(refs)])
      const result = []
      for (const pin of clean) {
        const source = `${batchKey}/${pin.key}`
        const existing = await client.query('SELECT id, status FROM pins WHERE source_key = $1', [source])
        if (existing.rowCount) { result.push({ ...existing.rows[0], key: pin.key, created: false }); continue }
        const { rows: [created] } = await client.query(`INSERT INTO pins
          (id,collection_id,title,description,product,asin,image,alt,affiliate_url,board,status,source_key,notes,prompt,kind)
          SELECT COALESCE(MAX(id),0)+1,$1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',$10,$11,$12,$13 FROM pins RETURNING id,status`,
        [batchKey,pin.title,pin.description,pin.product,pin.asin,pin.image,pin.alt,pin.affiliateUrl,pin.board,source,pin.notes,pin.prompt,pin.kind])
        result.push({ ...created, key: pin.key, created: true })
      }
      await client.query('COMMIT')
      res.json({ batchKey, pins: result })
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  })
  return router
}

