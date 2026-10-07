import { Router } from 'express'
import { mkdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
export const collectionColumns = `id, name, short_name AS "shortName", board_name AS "boardName", prompt, reference_images AS "referenceImages", version`
const bad = message => Object.assign(new Error(message), { status: 400 })
export function validateReferences(value) {
  if (!Array.isArray(value) || value.length > 16) throw bad('Máximo 16 referencias por subtablero.')
  return value.map(item => {
    if (!item || typeof item.name !== 'string' || item.name.length > 300 || typeof item.image !== 'string' || !/^\/media\/[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp)$/.test(item.image)) throw bad('Referencia local no válida.')
    const asin = item.asin || '', sourceUrl = item.sourceUrl || ''
    if (typeof asin !== 'string' || (asin && !/^[A-Z0-9]{10}$/.test(asin))) throw bad('ASIN de referencia no válido.')
    if (typeof sourceUrl !== 'string' || sourceUrl.length > 2048) throw bad('Enlace de referencia no válido.')
    if (sourceUrl) {
      let url
      try { url = new URL(sourceUrl) } catch { throw bad('Enlace de referencia no válido.') }
      if (url.protocol !== 'https:' || url.username || url.password || !['amazon.es', 'www.amazon.es', 'amzn.to'].includes(url.hostname)) throw bad('Usa el enlace del producto de Amazon España.')
    }
    return { name: item.name.trim(), image: item.image, asin, sourceUrl }
  })
}
export function collectionsRouter(pool, { mediaDir = '/app/media' } = {}) {
  const router = Router()
  router.get('/collections', async (req, res) => res.json((await pool.query(`SELECT ${collectionColumns} FROM collections ORDER BY id`)).rows))
  router.patch('/collections/:collectionId', async (req, res) => {
    const { version, name, boardName, prompt, referenceImages } = req.body || {}
    if (!Number.isSafeInteger(version) || version < 1) throw bad('La versión es obligatoria.')
    for (const [value, max] of [[name, 200], [boardName, 200], [prompt, 12000]]) if (typeof value !== 'string' || value.length > max) throw bad('Revisa el nombre, tablero y prompt.')
    if (!name.trim()) throw bad('Escribe el nombre del subtablero.')
    const refs = validateReferences(referenceImages)
    const result = await pool.query(`UPDATE collections SET name=$1,short_name=$2,board_name=$3,prompt=$4,reference_images=$5,version=version+1
      WHERE id=$6 AND version=$7 RETURNING ${collectionColumns}`, [name.trim(), name.trim().slice(0,60), boardName.trim(), prompt, JSON.stringify(refs), req.params.collectionId, version])
    if (!result.rowCount) {
      const exists = await pool.query('SELECT id FROM collections WHERE id=$1', [req.params.collectionId])
      return res.status(exists.rowCount ? 409 : 404).json({ error: exists.rowCount ? 'Este subtablero cambió en otra ventana. Recarga antes de editar.' : 'Subtablero no encontrado.' })
    }
    res.json(result.rows[0])
  })
  router.post('/reference-images', async (req, res) => {
    const { data } = req.body || {}
    if (typeof data !== 'string' || data.length > 11200000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw bad('Archivo de imagen no válido (máximo 8 MB).')
    const bytes = Buffer.from(data, 'base64')
    if (bytes.length > 8 * 1024 * 1024) throw bad('Máximo 8 MB por imagen.')
    const ext = bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'png'
      : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'jpg'
        : bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP' ? 'webp' : null
    if (!ext) throw bad('Usa PNG, JPEG o WebP.')
    const filename = `ref-${randomUUID()}.${ext}`
    await mkdir(mediaDir, { recursive: true })
    await writeFile(path.join(mediaDir, filename), bytes, { flag: 'wx' })
    res.status(201).json({ image: `/media/${filename}` })
  })
  return router
}
