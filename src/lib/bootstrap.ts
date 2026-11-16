import { createIsomorphicFn } from '@tanstack/react-start'

// Only initial document requests read D1. Client navigation keeps using Query's cache.
export const loadBootstrap = createIsomorphicFn()
  .server(async () => {
    const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server')
    const { env } = await import('cloudflare:workers')
    const { requestLocale } = await import('./locale')
    const { loadCatalogue } = await import('./catalogue')
    const { publicPage } = await import('../server/public-page')
    const request = getRequest()
    const language = requestLocale(request.headers.get('cookie'), request.headers.get('accept-language'))
    const [catalogue, queries] = await Promise.all([
      loadCatalogue(language.locale),
      publicPage({ ...env, DB: env.DB.withSession('first-unconstrained') }, new URL(request.url)).catch(() => null),
    ])
    const path = new URL(request.url).pathname
    const needsMetadata = path === '/watch' || path === '/playlist' || path.startsWith('/channel/') || path.startsWith('/@')
    const cacheable = !needsMetadata || !!queries?.queries.length
    setResponseHeader('Cache-Control', cacheable ? 'public, max-age=0' : 'no-store')
    if (cacheable) setResponseHeader('Cloudflare-CDN-Cache-Control', 'public, max-age=60, stale-while-revalidate=300, stale-if-error=0')
    setResponseHeader('Vary', 'Accept-Language, Cookie')
    return { language: { ...catalogue, preference: language.preference }, queries }
  })
  .client(async () => null)
