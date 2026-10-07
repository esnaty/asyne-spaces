import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readAmazonLink, manualAmazonProduct } from '../../src/data/amazon.js'

test('Amazon manual extracts ASIN and preserves affiliate parameters exactly', () => {
  const link = 'https://www.amazon.es/Producto/dp/B0FGPCG599?tag=ejemplo-21&linkCode=ll1'
  assert.equal(readAmazonLink(link).asin, 'B0FGPCG599')
  assert.deepEqual(manualAmazonProduct({ name: ' Taza ', asin: 'b0fgpcg599', link }), {
    product: 'Taza', asin: 'B0FGPCG599', affiliateUrl: link,
  })
  assert.equal(readAmazonLink('https://amazon.es/gp/product/B0FGPCG599').asin, 'B0FGPCG599')
})
test('short links require manual ASIN and never invent affiliate tags', () => {
  const link = 'https://amzn.to/example'
  assert.equal(readAmazonLink(link).asin, '')
  assert.throws(() => manualAmazonProduct({ name: 'Taza', asin: '', link }))
  assert.equal(manualAmazonProduct({ name: 'Taza', asin: 'B0FGPCG599', link }).affiliateUrl, link)
})
test('rejects unsafe URLs, lookalike domains and inconsistent product identifiers', () => {
  for (const link of ['javascript:alert(1)', 'https://amazon.es.evil.test/dp/B0FGPCG599', 'https://user:pass@amazon.es/dp/B0FGPCG599', 'http://amazon.es/dp/B0FGPCG599', 'https://amazon.es/']) {
    assert.throws(() => readAmazonLink(link))
  }
  assert.throws(() => manualAmazonProduct({ name: 'Taza', asin: 'B0XXXXXXXX', link: 'https://amazon.es/dp/B0FGPCG599' }))
  assert.throws(() => manualAmazonProduct({ name: '', asin: 'B0FGPCG599', link: 'https://amzn.to/example' }))
})
