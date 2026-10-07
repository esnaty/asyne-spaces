import pg from 'pg'
import { collections, pins } from '../src/data/pins.js'

export function createPool(options = {}) {
  return new pg.Pool({ connectionTimeoutMillis: 5000, ...options })
}

export async function initializeDatabase(pool) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(51803001)')
    await client.query(`
      CREATE TABLE IF NOT EXISTS collections (
        id text PRIMARY KEY,
        name text NOT NULL,
        short_name text NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pinterest_oauth_states (
        state_hash text PRIMARY KEY,
        browser_hash text NOT NULL,
        expires_at timestamptz NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pinterest_connection (
        id integer PRIMARY KEY CHECK (id = 1),
        tokens text NOT NULL,
        username text NOT NULL,
        expires_at timestamptz NOT NULL,
        fingerprint text NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pins (
        id integer PRIMARY KEY,
        collection_id text NOT NULL REFERENCES collections(id),
        title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 100),
        description text NOT NULL DEFAULT '',
        product text NOT NULL,
        asin text NOT NULL,
        image text NOT NULL,
        alt text NOT NULL,
        affiliate_url text NOT NULL DEFAULT '',
        board text NOT NULL DEFAULT '',
        scheduled_at timestamptz,
        status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'approved', 'published')),
        version integer NOT NULL DEFAULT 1,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `)
    await client.query(`ALTER TABLE pins ADD COLUMN IF NOT EXISTS prompt text NOT NULL DEFAULT ''; ALTER TABLE pins ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'product' CHECK (kind IN ('base', 'product'));`)
    // Upgrade existing installations without replacing any editorial data.
    await client.query(`ALTER TABLE collections ADD COLUMN IF NOT EXISTS board_name text NOT NULL DEFAULT '';
      ALTER TABLE collections ADD COLUMN IF NOT EXISTS prompt text NOT NULL DEFAULT '';
      ALTER TABLE collections ADD COLUMN IF NOT EXISTS reference_images jsonb NOT NULL DEFAULT '[]';
      ALTER TABLE collections ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;`)
    await client.query('ALTER TABLE pins ADD COLUMN IF NOT EXISTS source_key text UNIQUE; ALTER TABLE pins ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT \'\';')
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'pins'::regclass AND conname = 'pins_status_check_v2'
        ) THEN
          ALTER TABLE pins DROP CONSTRAINT IF EXISTS pins_status_check;
          ALTER TABLE pins ADD CONSTRAINT pins_status_check_v2
            CHECK (status IN ('draft', 'ready', 'approved', 'published', 'discarded'));
        END IF;
      END $$;
    `)
    for (const collection of collections) {
      await client.query('INSERT INTO collections (id, name, short_name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [collection.id, collection.name, collection.shortName])
    }
    for (const pin of pins) {
      await client.query(`INSERT INTO pins (id, collection_id, title, product, asin, image, alt)
        VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
      [pin.order, pin.collection, pin.title, pin.product, pin.asin, pin.image, pin.alt])
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export const pinColumns = `id, id AS "order", collection_id AS collection, title, description,
  product, asin, image, alt, affiliate_url AS "affiliateUrl", board,
  scheduled_at AS "scheduledAt", status, version, notes, prompt, kind, source_key AS "sourceKey", updated_at AS "updatedAt"`

