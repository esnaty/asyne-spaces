import { createPool, initializeDatabase } from './db.js'
import { createApp } from './app.js'

const pool = createPool()
pool.on('error', error => console.error('Database connection failed:', error.code))
await initializeDatabase(pool)
const server = createApp(pool).listen(3000, '0.0.0.0', () => console.log('Asyne Studio API listening on port 3000'))
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(async () => { await pool.end(); process.exit(0) })
    setTimeout(() => process.exit(1), 10000).unref()
  })
}
