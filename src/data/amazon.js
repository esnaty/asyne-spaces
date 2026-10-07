// Parse only the supplied text. No requests to Amazon or short-link expansion.
export function readAmazonLink(value) {
  let url
  try { url = new URL(value.trim()) } catch { throw new Error('Pega un enlace válido de Amazon España o amzn.to.') }
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
    !['amazon.es', 'www.amazon.es', 'amzn.to'].includes(url.hostname)) {
    throw new Error('Usa un enlace https de amazon.es, www.amazon.es o amzn.to.')
  }
  if (url.pathname === '/') throw new Error('Pega el enlace de un producto, no la portada de Amazon.')
  const short = url.hostname === 'amzn.to'
  const asin = short ? '' : (url.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([a-z0-9]{10})(?:\/|$)/i)?.[1] || '').toUpperCase()
  return { url: value.trim(), asin, short, hasTag: !!url.searchParams.get('tag') }
}

export function manualAmazonProduct({ name, asin, link }) {
  const parsed = readAmazonLink(link)
  name = name.trim()
  asin = asin.trim().toUpperCase()
  if (!name || name.length > 300) throw new Error('Escribe un nombre de producto de hasta 300 caracteres.')
  if (!/^[A-Z0-9]{10}$/.test(asin)) throw new Error('El ASIN debe tener 10 letras o números. Puedes copiarlo de la ficha de Amazon.')
  if (parsed.asin && parsed.asin !== asin) throw new Error('El ASIN no coincide con el producto del enlace. Revisa ambos datos.')
  if (parsed.url.length > 2048) throw new Error('El enlace es demasiado largo.')
  return { product: name, asin, affiliateUrl: parsed.url }
}
